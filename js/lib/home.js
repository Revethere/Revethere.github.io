// Smooth-expand tuning. Durations scale with travel distance so long articles
// reveal statelier and short ones stay snappy; easings are fast-start / long
// glide curves. Tweak here to tune the feel.
const EXPAND_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"; // ease-out-quint
const COLLAPSE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const SETTLE_MS = 420; // content rise/fade duration (swap mode)
// Proportional durations: short posts stay snappy, long ones get a statelier
// glide (capped so they never feel sluggish).
const travelMs = (px) => Math.min(800, Math.round(320 + px * 0.08));
const collapseMs = (px) => Math.min(600, Math.round(280 + px * 0.05));

mixins.home = {
    mounted() {
        let background = this.$refs.homeBackground;
        let images = background.dataset.images.split(",");
        let id = Math.floor(Math.random() * images.length);
        background.style.backgroundImage = `url('${images[id]}')`;
        this.menuColor = true;
        this.initPostClamp();
        this.scheduleHeightCache();
        window.addEventListener("resize", this.onResize);
    },
    unmounted() {
        window.removeEventListener("resize", this.onResize);
    },
    methods: {
        homeClick() {
            window.scrollTo({ top: window.innerHeight, behavior: "smooth" });
        },
        initPostClamp() {
            this.$nextTick(() => {
                const posts = document.querySelectorAll("#home-posts .post");
                posts.forEach((post) => {
                    const desc = post.querySelector(".description");
                    const excerpt = desc?.querySelector(".excerpt-content");
                    if (!desc || !excerpt) return;
                    const lineHeight = 14 * 1.7;
                    const clampH = lineHeight * 10 + 30;
                    desc.style.setProperty("--clamp-h", clampH);
                    desc.style.maxHeight = clampH + "px";
                });
            });
        },
        // Measure the full height of swap-mode posts once, off the click path.
        // A `.full-content` that is display:none has never been laid out, so
        // reading its scrollHeight on click forces a full synchronous layout of
        // the whole article — the source of the freeze. Measuring it here (idle,
        // absolutely positioned / hidden so the page never moves) makes the click
        // handler read a cached value instead.
        scheduleHeightCache() {
            const run = () => {
                if (document.readyState !== "complete") {
                    setTimeout(run, 300);
                    return;
                }
                const measure = () => this.measureFullHeights();
                if ("requestIdleCallback" in window) {
                    requestIdleCallback(measure, { timeout: 2000 });
                } else {
                    setTimeout(measure, 2000);
                }
            };
            run();
        },
        measureFullHeights() {
            const posts = document.querySelectorAll(
                '#home-posts .post[data-has-more="true"]'
            );
            posts.forEach((post) => {
                if (post.dataset.single === "true") return; // no swap needed
                if (post.dataset.fullHeight) return;
                const desc = post.querySelector(".description");
                const full = post.querySelector(".full-content");
                if (!desc || !full) return;
                const width = desc.clientWidth;
                const prev = {
                    position: full.style.position,
                    display: full.style.display,
                    visibility: full.style.visibility,
                    left: full.style.left,
                    top: full.style.top,
                    width: full.style.width,
                    maxHeight: full.style.maxHeight,
                    contentVisibility: full.style.contentVisibility,
                };
                // content-visibility:auto would treat the offscreen probe as
                // skipped and report the contain-intrinsic-size estimate instead
                // of the real height — force a real layout while measuring.
                full.style.contentVisibility = "visible";
                full.style.position = "absolute";
                full.style.left = "-99999px";
                full.style.top = "0";
                full.style.visibility = "hidden";
                full.style.width = width + "px";
                full.style.display = "block";
                full.style.maxHeight = "none";
                post.dataset.fullHeight = full.scrollHeight; // one-time layout
                Object.assign(full.style, prev);
            });
        },
        onResize() {
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
                document
                    .querySelectorAll('#home-posts .post[data-has-more="true"]')
                    .forEach((post) => delete post.dataset.fullHeight);
                this.measureFullHeights();
            }, 200);
        },
        toggleExpand(event) {
            const post = event.target.closest(".post");
            if (!post) return;
            const desc = post.querySelector(".description");
            const moreBtn = post.querySelector(".more-center");
            const excerpt = post.querySelector(".excerpt-content");
            const full = post.querySelector(".full-content");
            const moreText = moreBtn?.querySelector(".more-text");
            const isExpanded = desc.classList.contains("expanded");
            const clampH =
                parseFloat(desc.style.getPropertyValue("--clamp-h")) || 268;

            if (isExpanded) {
                this.collapse(desc, moreBtn, moreText, excerpt, full, clampH, post);
            } else {
                this.expand(desc, moreBtn, moreText, excerpt, full, post);
            }
        },
        expand(desc, moreBtn, moreText, excerpt, full, post) {
            const isSingle = post?.dataset.single === "true";
            // Current rendered (clamped) height — offsetHeight, NOT scrollHeight.
            // scrollHeight is the unclipped full height, which made the old
            // animation a no-op (both keyframes identical → content snapped open).
            const startH = desc.offsetHeight;

            // Target height, resolved without forcing layout in the click path:
            // - single mode: the full article is already in the visible excerpt
            //   subtree, so scrollHeight is a cheap, cached read.
            // - swap mode: use the idle-measured cache; only fall back to a live
            //   read if measurement hasn't run yet (first click, rare).
            let endH;
            if (isSingle) {
                endH = desc.scrollHeight;
            } else {
                const cached = parseFloat(post?.dataset.fullHeight);
                endH = Number.isFinite(cached) ? cached : null;
            }

            // Pin the start state so the WAAPI from-keyframe matches.
            desc.style.maxHeight = startH + "px";
            desc.offsetHeight; // force layout (small, clamped state)

            // Swap to full content (swap mode only) and settle it into view:
            // a soft fade-up that runs in parallel with the height glide.
            if (!isSingle && full) {
                if (excerpt) excerpt.style.display = "none";
                full.style.display = "";
                full.style.opacity = "0";
                full.style.transform = "translateY(18px)";
                full.offsetHeight; // commit the hidden start state
                full.style.transition =
                    `opacity ${SETTLE_MS}ms ${EXPAND_EASING}, transform ${SETTLE_MS}ms ${EXPAND_EASING}`;
                full.style.opacity = "1";
                full.style.transform = "translateY(0)";
                if (endH === null) endH = desc.scrollHeight; // fallback
            }
            if (endH === null || endH <= startH) endH = startH;

            // Fade out the ::after overlay immediately
            desc.classList.add("expanded");
            if (moreBtn) moreBtn.classList.add("expanded");
            if (moreText) moreText.textContent = "COLLAPSE";
            if (post) post.classList.add("animating");

            desc.animate(
                { maxHeight: [startH + "px", endH + "px"] },
                {
                    duration: travelMs(endH - startH),
                    easing: EXPAND_EASING,
                    fill: "forwards",
                }
            ).onfinish = () => {
                desc.style.maxHeight = "none";
                if (post) post.classList.remove("animating");
            };
        },
        collapse(desc, moreBtn, moreText, excerpt, full, clampH, post) {
            const isSingle = post?.dataset.single === "true";
            const startH = desc.offsetHeight;
            desc.style.maxHeight = startH + "px";
            desc.offsetHeight; // force layout

            // Swap back to excerpt (swap mode only) and reset the settle styles
            // applied by the last expand so the next one re-fades cleanly.
            if (!isSingle && full) {
                full.style.display = "none";
                full.style.opacity = "";
                full.style.transform = "";
                full.style.transition = "";
                if (excerpt) excerpt.style.display = "";
            }

            // Fade the ::after overlay back in
            desc.classList.remove("expanded");
            if (moreBtn) moreBtn.classList.remove("expanded");
            if (moreText) moreText.textContent = "MORE";
            if (post) post.classList.add("animating");

            desc.animate(
                { maxHeight: [startH + "px", clampH + "px"] },
                {
                    duration: collapseMs(startH - clampH),
                    easing: COLLAPSE_EASING,
                    fill: "forwards",
                }
            ).onfinish = () => {
                desc.style.maxHeight = clampH + "px";
                if (post) post.classList.remove("animating");
            };
        },
    },
};
