// How far into the wallpaper's exit the menu starts and finishes its morph into
// a floating capsule, as a fraction of the wallpaper's own height — home page
// only. 0.5 is where half of it is still on screen, 1 is where it is gone
// entirely, so the capsule is complete exactly as the wallpaper leaves. A page
// with no wallpaper has nothing to wait for and starts at the first pixel of
// scroll instead; see updateMenuMorph. The geometry that reads these lives in
// #menu in main.css.
const MENU_MORPH_FROM = 0.5;
const MENU_MORPH_TO = 1;
// How far the morph has to be along before the panel is allowed to become glass,
// on pages that have no wallpaper to wait for. Far enough in that the bar is
// visibly a capsule already, so the two do not arrive at once.
const MENU_CLOUD_AT = 0.25;

const app = Vue.createApp({
    mixins: Object.values(mixins),
    data() {
        return {
            loading: true,
            showMenuItems: false,
            menuColor: false,
            menuCloud: false,
            scrollTop: 0,
            renderers: [],
            morphQueued: false,
        };
    },
    created() {
        window.addEventListener("load", () => {
            this.loading = false;
            // The list pages' rows rise in with a 20ms stagger, and the gate for
            // that is this class rather than the markup: the loader covers the
            // page until `load`, so an animation declared statically would have
            // finished behind it. Vue patches the app's elements on mount and
            // leaves <html> alone, which is why the flag lives there.
            document.documentElement.classList.add("page-loaded");
        });
    },
    mounted() {
        // The loading word's sweep waits for this. Vue renders the whole layout
        // from its own template, so mounting *replaces* the markup that was
        // already on screen — the loader included. A CSS animation declared on the
        // word would therefore run once on the page's own markup and then start
        // over on Vue's copy: the word reached "A", the node was swapped, and the
        // sweep began again at "L". Hiding the animation behind this class gives
        // it exactly one start, on the elements that survive. Set on <html>
        // because Vue patches the app's own elements and never touches this one.
        document.documentElement.classList.add("app-ready");
        window.addEventListener("scroll", this.handleScroll, true);
        window.addEventListener("resize", this.queueMenuMorph);
        // The menu is wired up *before* the renderers run, not after. The renderers
        // are third-party and one of them throws when its own script did not load:
        // KaTeX's auto-render is a global that is simply absent when that CDN
        // request fails, so math() raises. This used to sit behind render(), which
        // meant a missing CDN script silently took the hover listeners, the
        // restored-scroll sync and the first morph with it — for the whole visit,
        // since nothing re-attaches them. The menu depends on none of it.
        this.initMenuIndicator();
        // The browser can restore a scroll position before this runs, so the
        // stored one is taken from the document rather than assumed to be zero —
        // otherwise the menu sits at rest until the next scroll event corrects it.
        // menuColor has to be brought in line with it too, and by the same test
        // handleScroll uses: home.js sets it true on the assumption that the page
        // opens at the top, and a restored position is past the wallpaper, where
        // leaving it true would hold the bar in its resting material over the
        // posts. One test, one definition — the cloud gate reads this value.
        this.scrollTop = document.documentElement.scrollTop;
        if (this.$refs.homePostsWrap && this.scrollTop > window.innerHeight - 100) {
            this.menuColor = false;
        }
        this.queueMenuMorph();
        this.render();
    },
    methods: {
        // Isolated one from the next. Each renderer calls into a global that its
        // own script provides — highlight.js, KaTeX, the preview overlay, the
        // article TOC — and one of those scripts failing to load used to stop
        // every renderer after it as well. Logged rather than swallowed, so a
        // missing script is still visible in the console.
        render() {
            for (let i of this.renderers) {
                try {
                    i();
                } catch (error) {
                    console.error(error);
                }
            }
        },
        initMenuIndicator() {
            const desktopMenu = document.getElementById("desktop-menu");
            if (!desktopMenu) return;
            const indicator = document.getElementById("menu-indicator");
            if (!indicator) return;
            // Top level only. A group's panel is full of links too, and those must
            // not drive the pill: it is sized and placed against the bar, so a row
            // inside a panel would leave it floating in the middle of nothing.
            // The wrapper a group sits in is not a link, hence the second half.
            const links = desktopMenu.querySelectorAll(
                ":scope > a, :scope > .menu-group > a"
            );

            links.forEach(link => {
                link.addEventListener("mouseenter", () => {
                    const linkRect = link.getBoundingClientRect();
                    const menuRect = desktopMenu.getBoundingClientRect();
                    indicator.style.left = (linkRect.left - menuRect.left) + "px";
                    indicator.style.width = linkRect.width + "px";
                    indicator.classList.add("visible");
                });
            });

            desktopMenu.addEventListener("mouseleave", () => {
                indicator.classList.remove("visible");
            });
        },
        // One number drives the whole menu morph, and it only moves on a scroll
        // or a resize, so it is written straight onto the element instead of
        // through the template: a reactive value here would re-render the app
        // once per frame of every scroll.
        updateMenuMorph() {
            this.morphQueued = false;
            const menu = document.getElementById("menu");
            if (!menu) return;
            let progress = 0;
            // The morph is desktop only. 901, not 900: the stylesheet hands over to
            // the mobile menu at a max-width of 900 and that block comes last, so
            // exactly 900px is already the mobile bar — which stays the plain
            // full-width strip it has always been.
            if (window.matchMedia("(min-width: 901px)").matches) {
                const hero = document.getElementById("home-head");
                let from, to;
                if (hero) {
                    // The wallpaper's own height sets both ends, so the capsule is
                    // complete exactly as the wallpaper leaves and the bar has
                    // something to shrink against the whole way.
                    from = hero.offsetHeight * MENU_MORPH_FROM;
                    to = hero.offsetHeight * MENU_MORPH_TO;
                } else {
                    // Off the home page there is nothing to wait for, so the morph
                    // starts on the first pixel of scroll rather than after half a
                    // screen of it. The page's own scrollable range sets the pace,
                    // capped at one screen so a long article does not take forever;
                    // the 240px floor is for a page too short to give it that much,
                    // which would otherwise never morph at all.
                    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
                    from = 0;
                    to = Math.min(window.innerHeight, Math.max(240, scrollable));
                }
                progress = (this.scrollTop - from) / Math.max(1, to - from);
                progress = Math.min(1, Math.max(0, progress));
                // Smoothstep. Running the scroll straight through makes the bar
                // crawl at both ends and snap through the middle; this eases it
                // out of the wallpaper and settles it into the capsule, and reads
                // the same on the way back up.
                progress = progress * progress * (3 - 2 * progress);
            }
            menu.style.setProperty("--mp", progress.toFixed(4));
            // The material is not a function of the morph — it is switched, once,
            // here. On the home page the bar sits on the wallpaper with white
            // labels until the wallpaper leaves it, and a glass panel under white
            // labels is no labels at all, so the glass waits for that instead of
            // for --mp. menuColor is that moment: home.js and handleScroll hold it
            // true for exactly as long as the wallpaper is behind the bar. Off the
            // home page there is no wallpaper, so the morph alone decides.
            const overWallpaper = !!this.$refs.homePostsWrap && this.menuColor;
            this.menuCloud = progress > MENU_CLOUD_AT && !overWallpaper;
        },
        queueMenuMorph() {
            if (this.morphQueued) return;
            this.morphQueued = true;
            window.requestAnimationFrame(this.updateMenuMorph);
        },
        handleScroll() {
            let wrap = this.$refs.homePostsWrap;
            let newScrollTop = document.documentElement.scrollTop;
            // The bar itself no longer retracts on the way down — it stays put
            // and morphs instead (see updateMenuMorph). The mobile dropdown is a
            // different thing: it is an overlay the bar would otherwise trail
            // down the page, so scrolling still closes that one.
            if (this.scrollTop < newScrollTop) this.showMenuItems = false;
            if (wrap) {
                if (newScrollTop <= window.innerHeight - 100) this.menuColor = true;
                else this.menuColor = false;
                if (newScrollTop <= 400) wrap.style.top = "-" + newScrollTop / 5 + "px";
                else wrap.style.top = "-80px";
            }
            this.scrollTop = newScrollTop;
            this.queueMenuMorph();
        },
    },
});
app.mount("#layout");
