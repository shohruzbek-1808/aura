Project: MILA

**Setting up ollama**
1. Install ollama
Goto [Ollama downloads](https://ollama.com/download) for installation in supported platforms

2. Start ollama
```bash
ollama serve
```

3. Install a model
This project defaults to [qwen3:4b](https://ollama.com/library/qwen3). Qwen 3.5 can also be used by setting `AURA_MODEL=qwen3.5:4b` before starting Flask.
```bash
ollama run qwen3:4b
```

**Run instructions**
1. Clone repository
```bash
git clone https://github.com/shohruzbek-1808/aura.git
```

2. cd to the directory
```bash
cd aura
```

3. Create new python virtual environment and activate it
```bash
python -m venv venv
```

*Activation*
- Windows (cmd)
```bash
venv/Scripts/activate
```

- Linux & MacOS (bash/zsh)
```bash
source venv/bin/activate
```

- Linux & MacOS (fish)
```fish
source venv/bin/activate.fish
```

4. Install dependencies
```bash
pip install -r requirements.txt
```

5. Running
```bash
flask run --debug
```


