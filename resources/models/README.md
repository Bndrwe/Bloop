# resources/models

Put the fine-tuned Bloop model here to ship it inside the app.

```
npm run model:bundle        # copies the newest ml/out/bloop-*-Q4_K_M.gguf here + writes bloop-model.json
npm run build               # electron-builder copies this folder to <resources>/resources/models/
```

- Only this README and `.gitkeep` are committed. `*.gguf` and `bloop-model.json` are gitignored
  (GitHub rejects files over 100 MB).
- The app finds the model at `<repo>/resources/models` (dev) or `<process.resourcesPath>/resources/models` (packaged).
- A bundled model is OFF until the user picks "Use Bloop model" in Settings -> AI.
- With no `.gguf` here the build still succeeds (it just warns) and users can Import a `.gguf`.
