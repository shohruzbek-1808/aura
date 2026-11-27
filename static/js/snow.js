const canvas = document.getElementById("snow");
const isMobileDevice = window.matchMedia(
    "(max-width: 800px), (pointer: coarse)",
).matches;
const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
).matches;
const context =
    isMobileDevice || prefersReducedMotion ? null : canvas.getContext("2d");

if (!context) {
    canvas.hidden = true;
}

const prompt = document.querySelector(".prompt-area");

let width = 0;
let height = 0;
let flakes = [];
let lastFrame = 0;

function createFlake() {
    return {
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 0.7 + Math.random() * 2,
        speed: 24 + Math.random() * 54,
        drift: (Math.random() - 0.5) * 18,
        opacity: 0.3 + Math.random() * 0.55,
    };
}

function resize() {
    if (!context) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const count = Math.max(60, Math.min(180, Math.round((width * height) / 12000)));
    flakes = Array.from({ length: count }, createFlake);
}

function draw(timestamp) {
    if (!context) return;
    const delta = Math.min((timestamp - lastFrame) / 1000 || 0, 0.05);
    lastFrame = timestamp;
    context.clearRect(0, 0, width, height);

    for (const flake of flakes) {
        flake.x += flake.drift * delta;
        flake.y += flake.speed * delta;
        if (flake.y - flake.radius > height) {
            flake.x = Math.random() * width;
            flake.y = -flake.radius;
        }
        if (flake.x < -flake.radius) flake.x = width + flake.radius;
        if (flake.x > width + flake.radius) flake.x = -flake.radius;

        context.beginPath();
        context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
        context.fill();
    }

    const promptBounds = prompt.getBoundingClientRect();
    context.clearRect(
        promptBounds.left - 8,
        promptBounds.top - 8,
        promptBounds.width + 16,
        promptBounds.height + 16,
    );

    requestAnimationFrame(draw);
}

if (context) {
    window.addEventListener("resize", resize);
    resize();
    requestAnimationFrame(draw);
}
