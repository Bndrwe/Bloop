# resources/models

Put a Bloop model (normally the fine-tuned build from `ml/`; any `.gguf` works) here to ship it inside the app. Without one, Bloop uses the stock Qwen3.5-0.8B via the in-app **Download…** button.

```
npm run model:bundle        # copies the newest ml/out/bloop-*-Q4_K_M.gguf here + writes bloop-model.json
npm run build               # electron-builder copies this folder to <resources>/resources/models/
```

- Only this README and `.gitkeep` are committed. `*.gguf` and `bloop-model.json` are gitignored
  (GitHub rejects files over 100 MB).
- The app finds the model at `<repo>/resources/models` (dev) or `<process.resourcesPath>/resources/models` (packaged).
- A bundled model is OFF until the user picks "Use Bloop model" in Settings -> AI -> Use Local -> Bloop model.
- With no `.gguf` here the build still succeeds (it just warns) and users can Import a `.gguf`.
