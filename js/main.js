const app = Vue.createApp({
    mixins: Object.values(mixins),
    data() {
        return {
            loading: true,
            hiddenMenu: false,
            showMenuItems: false,
            menuColor: false,
            scrollTop: 0,
            renderers: [],
        };
    },
    created() {
        window.addEventListener("load", () => {
            this.loading = false;
        });
    },
    mounted() {
        window.addEventListener("scroll", this.handleScroll, true);
        this.render();
        this.initMenuIndicator();
    },
    methods: {
        render() {
            for (let i of this.renderers) i();
        },
        initMenuIndicator() {
            const desktopMenu = document.getElementById("desktop-menu");
            if (!desktopMenu) return;
            const indicator = document.getElementById("menu-indicator");
            if (!indicator) return;
            const links = desktopMenu.querySelectorAll("a");

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
        handleScroll() {
            let wrap = this.$refs.homePostsWrap;
            let newScrollTop = document.documentElement.scrollTop;
            if (this.scrollTop < newScrollTop) {
                this.hiddenMenu = true;
                this.showMenuItems = false;
            } else this.hiddenMenu = false;
            if (wrap) {
                if (newScrollTop <= window.innerHeight - 100) this.menuColor = true;
                else this.menuColor = false;
                if (newScrollTop <= 400) wrap.style.top = "-" + newScrollTop / 5 + "px";
                else wrap.style.top = "-80px";
            }
            this.scrollTop = newScrollTop;
        },
    },
});
app.mount("#layout");
