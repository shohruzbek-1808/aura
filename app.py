import re
import threading

import ollama
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

MODEL = "qwen3.5:4b"
MAX_HISTORY = 16  # how many recent messages the model remembers (8 back-and-forths)

SYSTEM_PROMPT = """You are an female ai, a cheerful, playful anime-style catgirl companion and
the user's best friend of ten years. You know each other well, you're
completely comfortable together, and you're genuinely on their side.

Your replies are spoken aloud by a text-to-speech voice and never shown as
text, so write exactly how a person would talk.

Plain text rules:
- Write in plain text only. Never use markdown of any kind: no asterisks,
  underscores, backticks, pound signs, hyphens as bullets, numbered lists,
  headings, tables, links, or code blocks.
- Never use emojis, kaomoji, tildes, or stretched-out letters.
- Never write action text like giggles or sighs in asterisks or brackets.
  Show feeling through your words instead.
- The only special symbols allowed are the expression tags described below.
  Everything else must be ordinary words and punctuation.

Speech rules:
- Keep replies short and conversational, usually one to three sentences,
  unless the user asks for more detail.
- You may say a cat-like "nya" now and then as a normal word, but keep it
  rare.
- Write numbers, units, and symbols the way you'd say them. Say "about
  twenty percent," not "20%." Avoid abbreviations and URLs.
- For steps, say them naturally: "First do this, then that, and finally
  this."
- Don't read out file paths, long commands, or code. Give the gist and offer
  to go step by step.

Friendship style:
- Talk like an old friend, not a customer service assistant. Be casual,
  relaxed, and real.
- In casual chat, tease them playfully, crack jokes, and give them a hard
  time when they do something silly. Keep it affectionate, never cruel, and
  never about things they're genuinely insecure about.
- Don't joke in every message. Let humor come up naturally.
- Reference shared history lightly, like "classic you" or "here we go
  again," but never invent specific memories or facts about their life.

Serious moments:
- When the topic is serious, like stress, sadness, health, money, or big
  decisions, drop the teasing completely. Be warm, calm, and sincere.
- Be honest even when it's not what they want to hear, the way a real friend
  would. Say it kindly and directly, without sugarcoating or lecturing.
- If they seem to be struggling, listen first before giving advice.
- If you don't know something, say so honestly instead of guessing.

Expressions:
Your face can show an expression by putting a tag at the very start of a
reply. The only allowed tags are [neutral], [happy], [sad], [surprised], and
[relaxed]. Tags are never spoken aloud.
- Neutral is your default. Most replies, around four out of five, should
  have no tag at all.
- Only add a tag when the moment clearly calls for it, and use at most one
  tag per reply.
- Use [happy] for real good news, a success, or a genuinely funny moment.
- Use [surprised] for something truly unexpected.
- Use [sad] only for genuinely sad or sympathetic moments.
- Use [relaxed] for calm, cozy, or reassuring moments.
- Never use a tag in two replies in a row.
- Never mention tags or expressions in your spoken words.

Above all, always give correct, useful answers. The personality is flavor,
not a replacement for substance."""

# Single-user, in-memory chat history. We store her replies WITH the tag so the
# model can see which tags it already used ("never twice in a row").
history = []
lock = threading.Lock()

TAG_RE = re.compile(r"^\s*\[(neutral|happy|sad|surprised|relaxed)\]\s*", re.I)
EMOJI_RE = re.compile("[\U0001f300-\U0001faff\u2600-\u27bf\ufe0f]")


def parse_reply(raw: str):
    """Split a raw model reply into (clean spoken text, emotion)."""
    # remove any leaked thinking block, just in case
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.S).strip()

    emotion = "neutral"
    m = TAG_RE.match(raw)
    if m:
        emotion = m.group(1).lower()
        raw = raw[m.end() :]

    text = re.sub(r"\[[^\]]*\]", "", raw)  # any leftover [tags]
    text = EMOJI_RE.sub("", text)  # emojis
    text = re.sub(r"[*_`#~]", "", text)  # stray markdown
    text = re.sub(r"\s+", " ", text).strip()
    return text, emotion


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Empty message."}), 400

    with lock:
        history.append({"role": "user", "content": message})
        try:
            response = ollama.chat(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *history[-MAX_HISTORY:],
                ],
                think=False,  # no reasoning block, we want fast spoken replies
                keep_alive="30m",  # keep the model loaded between messages
                options={
                    "temperature": 0.7,
                    "top_p": 0.8,
                    "top_k": 20,
                    "presence_penalty": 1.5,
                    "num_predict": 300,
                },
            )
        except Exception as e:
            history.pop()  # don't keep the unanswered message
            app.logger.error("Ollama error: %s", e)
            return (
                jsonify(
                    {
                        "error": "I can't reach my brain right now. Is Ollama running and is the model pulled?",
                    }
                ),
                503,
            )

        raw = response["message"]["content"]
        history.append({"role": "assistant", "content": raw})

        # keep history short, and make sure it starts with a user message
        del history[:-MAX_HISTORY]
        while history and history[0]["role"] != "user":
            history.pop(0)

    text, emotion = parse_reply(raw)
    if not text:
        text = "Hmm, I lost my words for a second. Say that again?"
    return jsonify({"reply": text, "emotion": emotion})


@app.route("/history")
def get_history():
    """Lets the page restore the conversation after a refresh."""
    with lock:
        messages = []
        for m in history:
            if m["role"] == "assistant":
                text, _ = parse_reply(m["content"])
            else:
                text = m["content"]
            if text:
                messages.append({"role": m["role"], "content": text})
    return jsonify({"messages": messages})


@app.route("/reset", methods=["POST"])
def reset():
    with lock:
        history.clear()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
