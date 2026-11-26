import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ================== SETTINGS ==================
const box = document.getElementById("avatar");
const MODEL_FILE = box.dataset.model; // set in index.html with url_for(...)
const CHAT_URL = box.dataset.chatUrl; // Flask /chat route
const HISTORY_URL = box.dataset.historyUrl; // Flask /history route
const RESET_URL = box.dataset.resetUrl; // Flask /reset route

// Text-to-speech voice. Leave empty to auto-pick a female English voice.
// To force one, run avatar.listVoices() in the browser console and paste a name here.
const ENABLE_VOICE = false;
const VOICE_NAME = "";

const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "relaxed"];

// Your custom looks. Any emotion NOT listed here uses the normal one (value 1).
// Add more lines to make your own, e.g.  worried: { sad: 0.4, surprised: 0.3 }
const PRESETS = {
    sad: { sad: 0.6, ih: 1 },
};

// Every expression that an emotion is allowed to touch (all get cleared first)
const FACE_KEYS = [...EMOTIONS, "aa", "ih", "ou", "ee", "oh"];

// ================== SCENE SETUP ==================
const clock = new THREE.Clock();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
box.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
camera.position.set(0, 1.35, 0.7); // camera position: change to zoom in/out
camera.lookAt(0, 1.3, 0);

const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(1, 1, 1);
scene.add(light);
scene.add(new THREE.AmbientLight(0xff0000, 0.6));

const EXTRA = 3; // canvas is 3x the div's size. Bigger = more room to overflow

function resize() {
    const w = box.clientWidth * EXTRA;
    const h = box.clientHeight * EXTRA;
    renderer.setSize(w, h);
    camera.aspect = w / h;

    // widen the field of view so she stays the same size inside the div
    const baseFov = 30;
    camera.fov = THREE.MathUtils.radToDeg(
        2 * Math.atan(EXTRA * Math.tan(THREE.MathUtils.degToRad(baseFov / 2))),
    );
    camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(box);
resize();

// ================== LOAD THE MODEL ==================
let vrm = null;

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load(
    MODEL_FILE,
    (gltf) => {
        vrm = gltf.userData.vrm;
        VRMUtils.rotateVRM0(vrm);
        vrm.scene.traverse((o) => (o.frustumCulled = false));
        scene.add(vrm.scene);
        vrm.scene.rotation.y = THREE.MathUtils.degToRad(-10);

        setTimeout(() => {
            box.style.opacity = 1;
            box.style.right = "0";
        }, 1000);
        setTimeout(waveHello, 1500);
    },
    undefined,
    (err) => console.error("Could not load model from " + MODEL_FILE, err),
);

// ================== FACE CONTROL FUNCTIONS ==================

// "target" = where each expression should be (0 to 1).
// Every frame the face glides toward these values, so changes look smooth.
const target = {};

// Set one expression. Example: setExpression('happy', 1)
function setExpression(name, value = 1) {
    target[name] = value;
}

// Clear every face expression, then apply the chosen look.
// Uses your PRESETS if one exists, otherwise just turns that emotion fully on.
function showEmotion(name) {
    FACE_KEYS.forEach((e) => (target[e] = 0));
    const look = PRESETS[name] || { [name]: 1 };
    Object.assign(target, look);
}

// Back to a neutral face
function resetFace() {
    FACE_KEYS.forEach((e) => (target[e] = 0));
    stopTalking();
}

// Show an emotion for a while, then go back. Example: flashEmotion('surprised', 1500)
function flashEmotion(name, ms = 1500) {
    showEmotion(name);
    setTimeout(() => showEmotion("neutral"), ms);
}

// ---------- Talking (mouth moves open/closed) ----------
let talking = false;
function startTalking() {
    talking = true;
    mouthTimer = 0;
}
function stopTalking() {
    talking = false;
    mouthTimer = 0;
    target.aa = target.ih = target.ou = target.ee = target.oh = 0;
}

// ---------- Blinking (automatic) ----------
let nextBlink = 2;
function blinkNow() {
    target.blink = 1;
    setTimeout(() => (target.blink = 0), 120);
}

// ---------- Looking around ----------
function look(direction) {
    // 'left' | 'right' | 'up' | 'down' | 'center'
    ["lookLeft", "lookRight", "lookUp", "lookDown"].forEach(
        (e) => (target[e] = 0),
    );
    if (direction !== "center") {
        target["look" + direction[0].toUpperCase() + direction.slice(1)] = 0.8;
    }
}

// ================== BODY ANIMATION ==================
// The model starts in a T-pose. REST is the pose she returns to (arms down).
// Rotations are in radians. Left/right = the CHARACTER's left/right
// (her left hand appears on the RIGHT side of your screen).
const REST = {
    leftUpperArm: { z: -1.2 },
    rightUpperArm: { z: 1.2 },
};
const BONES = [
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
];

const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);

// Put every bone back to the rest pose (done every frame before an animation runs)
function applyRestPose() {
    BONES.forEach((name) => {
        const b = bone(name);
        if (!b) return;
        const r = REST[name] || {};
        b.rotation.set(r.x || 0, r.y || 0, r.z || 0);
    });
}

// Blend between rest value and animated value.  w = 0 -> rest, w = 1 -> full pose
const mix = (rest, pose, w) => rest + (pose - rest) * w;

// Play any animation:
//   duration = seconds
//   update(w, t) = your function, called every frame
//       w = strength 0..1 (fades in at the start, fades out at the end)
//       t = seconds since the animation started
let activeAnim = null;
function playAnimation(duration, update, onEnd) {
    activeAnim = { duration, update, onEnd, start: clock.elapsedTime };
}

// Called every frame from the loop
function runAnimation() {
    applyRestPose();
    if (!activeAnim) {
        if (!talking) {
            const b = bone("chest");
            if (b) b.rotation.x = Math.sin(clock.elapsedTime * 1.2) * 0.008;
            const head = bone("head");
            if (head) {
                head.rotation.z = Math.sin(clock.elapsedTime * 0.35) * 0.012;
                head.rotation.x = Math.sin(clock.elapsedTime * 0.6) * 0.006;
            }
        } else {
            const b = bone("chest");
            if (b) b.rotation.x = Math.sin(clock.elapsedTime * 2.2) * 0.018;
            const head = bone("head");
            if (head) {
                head.rotation.z = Math.sin(clock.elapsedTime * 1.1) * 0.025;
                head.rotation.x = Math.sin(clock.elapsedTime * 1.7) * 0.012;
            }
        }
        return;
    }

    const t = clock.elapsedTime - activeAnim.start;
    const FADE = 0.5; // seconds to ease in/out
    const w = Math.min(1, t / FADE, (activeAnim.duration - t) / FADE);
    activeAnim.update(Math.max(0, w), t);

    if (t >= activeAnim.duration) {
        const done = activeAnim.onEnd;
        activeAnim = null;
        if (done) done();
    }
}

// ---------- Wave hello with her RIGHT hand, relaxed ----------
function waveHello(seconds = 3.5) {
    showEmotion("relaxed");

    playAnimation(
        seconds,
        (w, t) => {
            bone("spine").rotation.z = mix(0, -Math.sin(t * 12) * 0.01, w);
            bone("chest").rotation.z = mix(0, -0.06, w);
            bone("head").rotation.z = mix(0, -0.08, w);

            // raise the RIGHT upper arm (rest is +1.2, so it goes to -0.7)
            bone("rightUpperArm").rotation.z = mix(1.2, -0.7, w);

            // bend the elbow so the hand points up, then swing it side to side
            const swing = Math.sin(t * 12) * 0.15;
            bone("rightLowerArm").rotation.z = mix(0, -(1.2 + swing), w);
        },
        () => showEmotion("neutral"),
    );
}

// Make these callable from the browser console or your own code
window.avatar = {
    setExpression,
    showEmotion,
    flashEmotion,
    resetFace,
    startTalking,
    stopTalking,
    speak,
    stopSpeaking,
    listVoices,
    resetChat,
    blinkNow,
    look,
    playAnimation,
    waveHello,
    bone,
    mix,
};

// ================== ANIMATION LOOP ==================
const MOUTH = ["aa", "ih", "ou", "ee", "oh"];
let mouthTimer = 0;
let visualTalkTimer = null;

function estimateVisualTalkDuration(text) {
    return Math.min(15000, Math.max(1800, text.length * 65));
}

function startVisualTalking(text, emotion = "neutral") {
    stopSpeaking();
    showEmotion(emotion);
    if (!text) return;

    startTalking();
    const duration = estimateVisualTalkDuration(text);
    visualTalkTimer = setTimeout(() => {
        stopTalking();
        visualTalkTimer = null;
        emotionTimer = setTimeout(() => showEmotion("neutral"), 1200);
    }, duration);
}

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    if (vrm) {
        // auto blink every 2-5 seconds
        if (t > nextBlink) {
            blinkNow();
            nextBlink = t + 2 + Math.random() * 3;
        }

        // fake talking: every ~0.1s pick a random mouth shape
        if (talking) {
            mouthTimer -= dt;
            if (mouthTimer <= 0) {
                mouthTimer = 0.08 + Math.random() * 0.1;
                MOUTH.forEach((m) => (target[m] = 0));
                target[MOUTH[Math.floor(Math.random() * MOUTH.length)]] =
                    0.4 + Math.random() * 0.5;
            }
        }

        // glide every expression toward its target value
        for (const name in target) {
            const current = vrm.expressionManager.getValue(name) ?? 0;
            const speed = name === "blink" ? 25 : 10; // blink is faster
            const next = current + (target[name] - current) * Math.min(1, dt * speed);
            vrm.expressionManager.setValue(name, next);
        }

        runAnimation(); // body pose / animation
        vrm.update(dt);
    }
    renderer.render(scene, camera);
}
animate();

// ================== TEXT TO SPEECH ==================
// Uses the browser's built-in voices (no extra install needed).
const FEMALE_HINTS = [
    "female", "aria", "jenny", "zira", "samantha", "karen", "tessa", "victoria",
    "fiona", "moira", "hazel", "susan", "libby", "sonia", "natasha", "emma",
    "google uk english female", "google us english",
];

let voice = null;

function pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;

    if (VOICE_NAME) {
        voice = voices.find((v) => v.name === VOICE_NAME) || null;
        if (voice) return;
    }

    const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
    voice =
        english.find((v) => FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h))) ||
        english[0] ||
        null;
}

function listVoices() {
    const names = speechSynthesis.getVoices().map((v) => `${v.name} (${v.lang})`);
    console.table(names);
    return names;
}

if (ENABLE_VOICE && "speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice; // voices load late in some browsers
}

let speechId = 0; // changes whenever a new reply starts, so old callbacks can be ignored
let emotionTimer = null;
let speechStartTimer = null;
let speechWarningShown = false;

function stopSpeaking() {
    speechId++;
    clearTimeout(emotionTimer);
    clearTimeout(speechStartTimer);
    clearTimeout(visualTalkTimer);
    visualTalkTimer = null;
    activeAnim = null;
    if (ENABLE_VOICE && "speechSynthesis" in window) speechSynthesis.cancel();
    stopTalking();
}

function showSpeechWarning(error) {
    console.error("Speech playback failed", error);
    if (speechWarningShown) return;
    speechWarningShown = true;
    addMessage(
        "ai",
        "I couldn't play audio. Check that your browser has speech synthesis enabled and at least one voice available.",
        "error",
    );
}

function useMouthOnly(id, text, error) {
    if (id !== speechId) return;
    clearTimeout(speechStartTimer);
    showSpeechWarning(error);
    const fallbackId = ++speechId;
    if (ENABLE_VOICE && "speechSynthesis" in window) speechSynthesis.cancel();
    startTalking();
    setTimeout(() => {
        if (fallbackId !== speechId) return;
        stopTalking();
        emotionTimer = setTimeout(() => {
            if (fallbackId === speechId) showEmotion("neutral");
        }, 1200);
    }, Math.min(15000, Math.max(1200, text.length * 65)));
}

function speak(text = "", emotion = "neutral") {
    startVisualTalking(text, emotion);
}

// ================== CHAT ==================
const form = document.getElementById("prompt-form");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const chatsEl = document.getElementById("chats");
let sending = false;

// role is "user" or "ai". textContent keeps text safe (no HTML injection).
function addMessage(role, text, extraClass = "") {
    const el = document.createElement("div");
    el.className = `msg ${role} ${extraClass}`.trim();
    el.textContent = text;
    chatsEl.appendChild(el);
    scrollChats();
    return el;
}

function addTyping() {
    const el = document.createElement("div");
    el.className = "msg ai typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    chatsEl.appendChild(el);
    scrollChats();
    return el;
}

function scrollChats() {
    chatsEl.scrollTo({ top: chatsEl.scrollHeight, behavior: "smooth" });
}

// grow the textarea as you type; disable the send button when empty
function updatePrompt() {
    promptEl.style.height = "auto";
    promptEl.style.height = promptEl.scrollHeight + "px";
    sendBtn.disabled = sending || !promptEl.value.trim();
}
promptEl.addEventListener("input", updatePrompt);

// Enter = send, Shift+Enter = new line
promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
    }
});

form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
});

// Send to Flask -> Ollama. Flask returns { reply, emotion }.
async function sendMessage() {
    const message = promptEl.value.trim();
    if (!message || sending) return;

    sending = true;
    stopSpeaking(); // interrupt her if she's still talking
    addMessage("user", message);
    promptEl.value = "";
    form.classList.add("sending");
    updatePrompt();

    look("up"); // "thinking" glance while waiting
    const typing = addTyping();

    try {
        const res = await fetch(CHAT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
        });
        const data = await res.json();
        typing.remove();
        look("center");

        if (!res.ok) throw new Error(data.error || "Something went wrong.");

        addMessage("ai", data.reply);
        speak(data.reply, EMOTIONS.includes(data.emotion) ? data.emotion : "neutral");
    } catch (err) {
        console.error("Chat request failed", err);
        typing.remove();
        look("center");
        addMessage("ai", err.message || "Couldn't reach the server.", "error");
    } finally {
        sending = false;
        form.classList.remove("sending");
        updatePrompt();
        promptEl.focus();
    }
}

// Restore the conversation after a page refresh
async function loadHistory() {
    try {
        const res = await fetch(HISTORY_URL);
        const data = await res.json();
        data.messages.forEach((m) =>
            addMessage(m.role === "user" ? "user" : "ai", m.content),
        );
    } catch (err) {
        console.warn("Could not load history", err);
    }
}

// Clear the conversation (page and server memory). Call from console: avatar.resetChat()
async function resetChat() {
    stopSpeaking();
    showEmotion("neutral");
    chatsEl.innerHTML = "";
    await fetch(RESET_URL, { method: "POST" });
}

updatePrompt();
loadHistory();