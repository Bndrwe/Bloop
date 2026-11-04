# Brief for Codex (or any browser agent): train the Bloop model on Google Colab

Copy everything below the line into Codex. It's written to work in Codex with browser control, or in any agent that can drive a browser. Before you start:

- The repo is pulled locally, including `ml/data/train.jsonl`, `ml/data/eval.jsonl` and the `ml/colab/train_bloop.ipynb` notebook. The notebook and dataset are still being written, so pull again once they land.
- You're signed in to Google in the browser.
- You have a free Hugging Face account, if you want the model published.

---

## Goal

Fine-tune **Qwen/Qwen3.5-0.8B** (https://huggingface.co/Qwen/Qwen3.5-0.8B) with LoRA on the Bloop dataset, using a **free Google Colab T4 GPU**. Then merge it, convert it to **GGUF**, quantize it to **Q4_K_M** (about 500 MB), and either publish it to Hugging Face or download the `.gguf`. Report back the download URL, the sha256 and the byte size.

## Files (in the local repo)

- Notebook: `ml/colab/train_bloop.ipynb`
- Training data: `ml/data/train.jsonl` and `ml/data/eval.jsonl`. These are chat JSONL: `{"messages":[{"role":"user",...},{"role":"assistant",...}]}`
- If the notebook doesn't exist yet, use the fallback cells at the bottom of this brief.

## Steps

1. Open https://colab.research.google.com and go to **File → Upload notebook**. Upload `ml/colab/train_bloop.ipynb`. Without the notebook, choose **New notebook** instead.
2. Choose **Runtime → Change runtime type → Hardware accelerator: T4 GPU → Save**. Run `!nvidia-smi` and confirm it shows a Tesla T4. If no GPU is available (quota), stop and tell me.
3. Open the **Files** sidebar (folder icon) and upload `train.jsonl` and `eval.jsonl` to `/content/`.
4. Run the notebook cells top to bottom: **Runtime → Run all**, or one at a time. Wait for each cell to finish and read its output before going on.
   - The install cell may print dependency warnings. Those are fine unless a later import fails.
   - If `flash-linear-attention` or `causal-conv1d` fails to install, skip it. Training just runs slower.
   - The training cell prints an ETA after a few timing steps. On a T4, expect about 5–15 minutes. Keep the tab active, because Colab disconnects idle sessions.
   - If a cell runs out of memory, re-run training with a smaller `max_len` (e.g. 768) or a lower batch or accumulation setting.
5. Check the conversion cell's output: there should be a file named `bloop-qwen3.5-0.8b-Q4_K_M.gguf` of about 400–600 MB. Copy the printed **sha256** and **size in bytes**.
6. Optional sanity check: run the quick-test cell (`llama-cli`) and confirm it prints a short, sensible reply or valid JSON.
7. Publish, if I want it hosted:
   - Run the publish cell. It calls `huggingface_hub.login()`.
   - **Stop and ask me for my Hugging Face write token. Never invent one, never store it in the notebook, and only paste it into the login prompt.**
   - It creates `<my-hf-username>/bloop-qwen3.5-0.8b-GGUF` and uploads the GGUF and the model card.
   - Copy the printed resolve URL. It looks like `https://huggingface.co/<user>/bloop-qwen3.5-0.8b-GGUF/resolve/main/bloop-qwen3.5-0.8b-Q4_K_M.gguf`
8. If I don't want to publish, download the `.gguf` instead: right-click it in the Files sidebar and choose **Download**. Save it somewhere I can find it.
9. If it ran, copy the eval summary table (base vs fine-tuned: JSON-valid %, schema-valid %, rule checks, latency).

## Report back

- `BLOOP_MODEL_URL` = the resolve URL, or "downloaded locally at <path>"
- `BLOOP_MODEL_SHA256` = the sha256
- `BLOOP_MODEL_BYTES` = the size in bytes
- The final training loss and eval loss, plus the eval table if it ran
- Any errors you hit and how you worked around them

## Rules

- Use only the free T4 runtime. Don't buy Colab compute units or upgrade.
- Don't change the dataset or the model choice.
- Don't share the token or the notebook publicly. Make the Hugging Face repo public only if I say so; otherwise create it private.
- If a step fails twice, stop and show me the error output.

## Fallback cells (only if `ml/colab/train_bloop.ipynb` isn't there)

```python
# 1. install
!pip -q install -U "transformers>=4.57" peft datasets accelerate huggingface_hub
!pip -q install flash-linear-attention causal-conv1d || true
```

```python
# 2. train (LoRA, loss on the assistant reply only) + merge
import torch
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import LoraConfig, get_peft_model
BASE = "Qwen/Qwen3.5-0.8B"
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float32).cuda()
model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM"))
def encode(ex):
    m = ex["messages"]
    prompt = tok.apply_chat_template(m[:-1], tokenize=False, add_generation_prompt=True)
    p = tok(prompt, add_special_tokens=False)["input_ids"]
    ids = tok(prompt + m[-1]["content"] + tok.eos_token, add_special_tokens=False, truncation=True, max_length=1024)["input_ids"]
    return {"input_ids": ids, "labels": ([-100] * len(p) + ids[len(p):])[:len(ids)]}
ds = load_dataset("json", data_files={"train": "/content/train.jsonl", "eval": "/content/eval.jsonl"})
train = ds["train"].map(encode, remove_columns=ds["train"].column_names)
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-4)
scaler = torch.amp.GradScaler(); model.train(); accum = 8
for epoch in range(2):
    for i, ex in enumerate(train.shuffle(seed=epoch)):
        x = torch.tensor([ex["input_ids"]]).cuda(); y = torch.tensor([ex["labels"]]).cuda()
        with torch.autocast("cuda", dtype=torch.float16):
            loss = model(input_ids=x, labels=y).loss / accum
        scaler.scale(loss).backward()
        if (i + 1) % accum == 0: scaler.step(opt); scaler.update(); opt.zero_grad()
        if i % 40 == 0: print(epoch, i, round(loss.item() * accum, 3))
model = model.merge_and_unload(); model.save_pretrained("bloop-merged"); tok.save_pretrained("bloop-merged")
```

```python
# 3. GGUF + Q4_K_M
!git clone --depth 1 https://github.com/ggml-org/llama.cpp
!pip -q install -r llama.cpp/requirements.txt
!python llama.cpp/convert_hf_to_gguf.py bloop-merged --outtype f16 --outfile bloop-f16.gguf
!cmake -S llama.cpp -B llama.cpp/build && cmake --build llama.cpp/build --target llama-quantize llama-cli -j4
!llama.cpp/build/bin/llama-quantize bloop-f16.gguf bloop-qwen3.5-0.8b-Q4_K_M.gguf Q4_K_M
!ls -l bloop-qwen3.5-0.8b-Q4_K_M.gguf && sha256sum bloop-qwen3.5-0.8b-Q4_K_M.gguf
```

```python
# 4. publish (ASK THE USER FOR THEIR TOKEN)
from huggingface_hub import login, create_repo, upload_file, whoami
login()
repo = f"{whoami()['name']}/bloop-qwen3.5-0.8b-GGUF"
create_repo(repo, private=True, exist_ok=True)
upload_file(path_or_fileobj="bloop-qwen3.5-0.8b-Q4_K_M.gguf", path_in_repo="bloop-qwen3.5-0.8b-Q4_K_M.gguf", repo_id=repo)
print(f"https://huggingface.co/{repo}/resolve/main/bloop-qwen3.5-0.8b-Q4_K_M.gguf")
```

Note: a **private** Hugging Face repo can't be downloaded by the Bloop app without a token. If the app should download the model directly, make the repo public (and check that Qwen's license allows redistribution), or load the `.gguf` into Bloop with **Settings → AI → Bloop model → Load from file**.
