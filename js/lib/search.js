// The archive page's browse controls. A search box narrows the timeline in
// place, a filter button beside it opens a panel with the tag / category
// filters and the sort, and the two sort buttons can each run in both
// directions. Rows that do not match animate out and the ones that do slide
// back, which is the .timeline transition in main.css (margin-top, opacity,
// visibility) — so this file only has to set those three properties per row.
//
// Filter state lives in the URL (q / tag / category / sort / dir), so a
// filtered view can be linked to. The panel itself is transient and stays out
// of the URL: the button is the only door in or out.
//
// Matching runs over title *and* body text, which needs __POSTS_DATA__; the
// timeline carries a path per row and that path ties a row back to its post. A
// row that matched in its body also grows the matched passage inside itself
// (.search-excerpts), so the reason it matched shows on screen.
//
// Spaces are significant when matching. Deleting them turned "ln i" in a LaTeX
// body into a hit for "ni" — a match the reader could not see anywhere. Runs of
// whitespace collapse to one space instead, and only a CJK query (written
// without spaces between words) still gets the space-free comparison.
const HAS_CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const collapseSpace = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
const squashSpace = (text) => text.toLowerCase().replace(/\s+/g, "");

// Lines of context kept either side of a matching line.
const EXCERPT_CONTEXT = 2;

// The panel's open / close height transition. Matches the CSS duration the row
// transitions use, so the list and the panel move as one gesture.
const PANEL_DURATION = 280;

const COLLATOR = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

// Base orders, before the direction is applied. `time` sorts oldest → newest in
// data terms, which is why its natural direction is "desc" (newest first, the
// order the archive has always opened in); a title list naturally runs A → Z.
const ARCHIVE_COMPARATORS = {
    time: (a, b) => Number(a.dataset.ts || 0) - Number(b.dataset.ts || 0),
    title: (a, b) => COLLATOR.compare(a.dataset.title || "", b.dataset.title || ""),
};
const DEFAULT_DIRECTION = { time: "desc", title: "asc" };
const DIRECTION_LABELS = {
    time: { asc: "OLDEST", desc: "NEWEST" },
    title: { asc: "A → Z", desc: "Z → A" },
};

function sorterFor(sort, direction) {
    const compare = ARCHIVE_COMPARATORS[sort] || ARCHIVE_COMPARATORS.time;
    const flip = direction === "asc" ? 1 : -1;
    return (a, b) => compare(a, b) * flip;
}

// Writing a new order into a column-reverse wrapper: build the order the reader
// should see, then append it backwards so the DOM (which is read bottom-up)
// matches it again.
function applyArchiveOrder(wrapper, rows, sorter) {
    const ordered = rows.slice().sort(sorter);
    for (let i = ordered.length - 1; i >= 0; i--) wrapper.appendChild(ordered[i]);
}

function parseList(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (error) {
        return [];
    }
}

// The tag / category a row's own link points at, or null when the link is an
// ordinary post link.
function filterFromHref(href) {
    let url;
    try {
        url = new URL(href, window.location.href);
    } catch (error) {
        return null;
    }
    if (url.pathname !== window.location.pathname) return null;
    const tag = url.searchParams.get("tag");
    if (tag) return { kind: "tag", value: tag };
    const category = url.searchParams.get("category");
    if (category) return { kind: "category", value: category };
    return null;
}

mixins.search = {
    data() {
        return {};
    },
    mounted() {
        const root = document.getElementById("archives");
        const wrapper = document.getElementById("timeline-wrap");
        if (!root || !wrapper) return;

        const input = document.getElementById("search-bar");
        const status = root.querySelector(".archive-status");
        const toggle = document.getElementById("archive-filter-toggle");
        const panel = document.getElementById("archive-panel");
        const count = toggle ? toggle.querySelector(".filter-count") : null;
        const options = Array.from(root.querySelectorAll(".archive-option"));
        const sortButtons = Array.from(root.querySelectorAll(".sort-button"));
        const directionButton = document.getElementById("archive-direction");
        const resetButton = document.getElementById("archive-reset");
        const rows = Array.from(wrapper.children).filter((node) => node.nodeType === 1);
        if (!rows.length) return;

        // What the filters need from each row, read once from the data attributes
        // the template put there.
        const rowInfo = new Map(
            rows.map((row) => [
                row,
                {
                    title: row.dataset.title || "",
                    ts: Number(row.dataset.ts) || 0,
                    tags: parseList(row.dataset.tags),
                    categories: parseList(row.dataset.categories),
                },
            ])
        );

        // Body text for the content search, keyed by the row's path. Without the
        // index the title search still works; only the bodies go missing.
        const bodyText = new Map();
        const rawPosts = window.__POSTS_DATA__;
        if (Array.isArray(rawPosts) && rawPosts.length) {
            for (const post of rawPosts) {
                bodyText.set(post.path, htmlToPlainText(post.content));
            }
        } else {
            console.warn("[search] window.__POSTS_DATA__ not available!");
        }

        // `dir` stays null until the reader flips it, so every sort opens in its
        // own natural direction and picking the other sort does not inherit a
        // direction that made sense for the previous one.
        const state = {
            query: "",
            tags: new Set(),
            categories: new Set(),
            sort: "time",
            dir: null,
        };
        // The order only has to be written when it changes: rewriting it on every
        // keystroke would fight the animation of the rows.
        let appliedOrder = "";

        const directionNow = () => state.dir || DEFAULT_DIRECTION[state.sort];

        // The panel's own transition state. Declared before the first setPanel
        // call below, or the call would hit the temporal dead zone.
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let panelTimer = 0;
        let panelWanted = false;
        setPanel(false);
        render();

        if (input) {
            input.addEventListener("input", () => {
                state.query = input.value.trim();
                render();
            });
        }

        root.addEventListener("click", (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;

            // The round button is the panel's only door.
            if (toggle && (target === toggle || toggle.contains(target))) {
                event.preventDefault();
                setPanel(!panelWanted);
                return;
            }

            // The footer action: empty the search box and drop every selected
            // tag and category. Sorting is its own thing, so it is left alone.
            if (resetButton && (target === resetButton || resetButton.contains(target))) {
                event.preventDefault();
                if (resetButton.disabled) return;
                state.query = "";
                if (input) input.value = "";
                state.tags.clear();
                state.categories.clear();
                render();
                return;
            }

            // One button says what it orders by and which way it runs.
            if (directionButton && (target === directionButton || directionButton.contains(target))) {
                event.preventDefault();
                state.dir = directionNow() === "asc" ? "desc" : "asc";
                render();
                return;
            }

            // An option toggles its value; the group is AND-ed: every selected
            // tag (or category) has to be on the post, not just one of them.
            const option = target.closest(".archive-option");
            if (option) {
                event.preventDefault();
                const group =
                    option.dataset.filterKind === "category" ? state.categories : state.tags;
                const value = option.dataset.filterValue || "";
                if (group.has(value)) group.delete(value);
                else group.add(value);
                render();
                return;
            }

            const sortButton = target.closest(".sort-button");
            if (sortButton) {
                event.preventDefault();
                const sort = sortButton.dataset.sort;
                if (!sort || sort === state.sort || !isArchiveSort(sort)) return;
                state.sort = sort;
                // Each order opens in its own natural direction; the previous
                // order's direction is not carried over.
                state.dir = null;
                render();
                return;
            }

            // A tag / category link inside a row jumps straight to that filter
            // instead of leaving for an old /tags/ or /categories/ URL.
            const infoLink = target.closest(".info a");
            if (!infoLink) return;
            const filter = filterFromHref(infoLink.getAttribute("href") || "");
            if (!filter) return;
            event.preventDefault();
            const group = filter.kind === "category" ? state.categories : state.tags;
            if (group.size === 1 && group.has(filter.value)) group.clear();
            else {
                group.clear();
                group.add(filter.value);
            }
            render();
        });

        // Clicking anywhere outside the panel puts it away again, and Escape does
        // the same for the keyboard.
        document.addEventListener("click", (event) => {
            if (!panel || !panelWanted) return;
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            if (panel.contains(target) || (toggle && toggle.contains(target))) return;
            setPanel(false);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || !panel || !panelWanted) return;
            setPanel(false);
            if (toggle) toggle.focus();
        });

        // The panel opens with a height transition instead of flipping `hidden`:
        // hiding it takes it out of the flow at once, so the list below used to
        // jump down before the options had finished animating in. The same
        // transition runs backwards on close.
        function setPanel(open) {
            if (!panel) return;
            if (open === panelWanted) return;
            panelWanted = open;
            if (toggle) toggle.setAttribute("aria-expanded", String(open));
            if (panelTimer) {
                clearTimeout(panelTimer);
                panelTimer = 0;
            }
            let settled = false;
            const finish = (hide) => {
                if (settled) return;
                settled = true;
                panel.removeEventListener("transitionend", onEnd);
                panel.style.transition = "";
                panel.style.height = "";
                panel.style.marginBottom = "";
                panel.style.opacity = "";
                panel.style.overflow = "";
                panel.style.paddingBottom = "";
                panel.style.paddingTop = "";
                if (hide) panel.hidden = true;
            };
            const onEnd = (event) => {
                if (event.target !== panel || event.propertyName !== "height") return;
                finish(!open);
            };
            panel.addEventListener("transitionend", onEnd);
            panelTimer = setTimeout(() => finish(!open), PANEL_DURATION + 140);
            if (open) {
                panel.hidden = false;
                const height = panel.scrollHeight;
                panel.style.overflow = "hidden";
                panel.style.height = "0px";
                panel.style.marginBottom = "0px";
                panel.style.opacity = "0";
                panel.style.paddingBottom = "0px";
                panel.style.paddingTop = "0px";
                if (reducedMotion.matches) {
                    finish(false);
                    return;
                }
                void panel.offsetHeight;
                panel.style.transition = `height ${PANEL_DURATION}ms ease, margin-bottom ${PANEL_DURATION}ms ease, padding ${PANEL_DURATION}ms ease, opacity ${PANEL_DURATION}ms ease`;
                panel.style.height = `${height}px`;
                panel.style.marginBottom = "";
                panel.style.paddingBottom = "";
                panel.style.paddingTop = "";
                panel.style.opacity = "1";
            } else {
                const height = panel.offsetHeight;
                if (reducedMotion.matches) {
                    finish(true);
                    return;
                }
                panel.style.overflow = "hidden";
                panel.style.height = `${height}px`;
                panel.style.opacity = "1";
                void panel.offsetHeight;
                panel.style.transition = `height ${PANEL_DURATION}ms ease, margin-bottom ${PANEL_DURATION}ms ease, padding ${PANEL_DURATION}ms ease, opacity ${PANEL_DURATION}ms ease`;
                panel.style.height = "0px";
                panel.style.marginBottom = "0px";
                panel.style.opacity = "0";
                panel.style.paddingBottom = "0px";
                panel.style.paddingTop = "0px";
            }
        }

        function render() {
            const direction = directionNow();
            const orderKey = `${state.sort}|${direction}`;
            if (orderKey !== appliedOrder) {
                applyArchiveOrder(wrapper, rows, sorterFor(state.sort, direction));
                appliedOrder = orderKey;
            }

            const matched = state.query ? buildMatches(state.query) : null;

            // Every height is read before any style is written: a collapsed row is
            // collapsed by its margin-top, so writing row by row would force a
            // fresh layout per row, and this runs on every keystroke.
            const heights = rows.map((row) => {
                const block = row.querySelector(".search-excerpts");
                return row.offsetHeight - (block ? block.offsetHeight : 0);
            });
            const gap = parseFloat(getComputedStyle(rows[0]).marginBottom) || 0;

            let visible = 0;
            rows.forEach((row, i) => {
                const info = rowInfo.get(row);
                const excerpts = matched ? matched.get(row.dataset.path) : undefined;
                // The groups narrow the list, they do not widen it: every selected
                // tag has to be on the post, likewise every selected category, and
                // both groups have to agree with the query text.
                const keep =
                    (!matched || excerpts !== undefined) &&
                    (!state.tags.size ||
                        [...state.tags].every((tag) => info.tags.includes(tag))) &&
                    (!state.categories.size ||
                        [...state.categories].every((path) => info.categories.includes(path)));

                setExcerpts(row, keep && excerpts && excerpts.length ? excerpts : null);
                row.style.opacity = keep ? "1" : "0";
                row.style.visibility = keep ? "visible" : "hidden";
                // The negative margin eats the row's own height plus the gap under
                // it, so a filtered-out row leaves no hole behind.
                row.style.marginTop = keep ? "0" : `${-(heights[i] + gap)}px`;
                if (keep) visible++;
            });

            updateStatus(visible);
            updateControls(direction);
        }

        // Every post whose title or body contains the query, mapped to the body
        // excerpts that matched. An empty list means the title alone matched:
        // there is nothing to show, the title is already on screen.
        function buildMatches(query) {
            const needle = collapseSpace(query);
            const matches = new Map();
            if (!needle) return matches;
            const spaceFree = HAS_CJK.test(needle);
            const needleSquashed = squashSpace(query);

            for (const [row, info] of rowInfo) {
                const content = bodyText.get(row.dataset.path);
                const lines = content ? content.split("\n") : [];
                const hit = [];
                for (let i = 0; i < lines.length; i++) {
                    if (lineMatches(lines[i])) hit.push(i);
                }
                if (hit.length) {
                    matches.set(row.dataset.path, excerptsFor(lines, hit));
                } else if (lineMatches(info.title)) {
                    matches.set(row.dataset.path, []);
                }
            }
            return matches;

            function lineMatches(text) {
                if (collapseSpace(text).includes(needle)) return true;
                return spaceFree && squashSpace(text).includes(needleSquashed);
            }
        }

        // The matching line indices, widened by EXCERPT_CONTEXT either way and
        // merged where they touch, so an excerpt reads as the passage the query
        // landed in rather than a bare line. A one-line gap is not worth a second
        // excerpt with a rule between them.
        function excerptsFor(lines, matchIndices) {
            const ranges = [];
            for (const index of matchIndices) {
                const from = Math.max(0, index - EXCERPT_CONTEXT);
                const to = Math.min(lines.length - 1, index + EXCERPT_CONTEXT);
                const last = ranges[ranges.length - 1];
                if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
                else ranges.push({ from, to });
            }

            return ranges
                .map((range) =>
                    lines
                        .slice(range.from, range.to + 1)
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0)
                        .join("\n")
                )
                .filter((excerpt) => excerpt.length > 0);
        }

        // Grows the excerpt block inside a row, or collapses it away when the row
        // has none. The measured height goes to max-height, which is the only way
        // to animate it; everything spaced inside has to be padding, because
        // scrollHeight is what gets measured.
        function setExcerpts(row, excerpts) {
            const content = row.querySelector(".timeline-content");
            if (!content) return;
            let block = content.querySelector(".search-excerpts");

            if (!excerpts || !excerpts.length) {
                if (block) {
                    block.classList.remove("shown");
                    block.style.maxHeight = "0px";
                }
                return;
            }

            if (!block) {
                block = document.createElement("div");
                block.className = "search-excerpts";
                content.appendChild(block);
            }

            const highlight = state.query
                ? new RegExp(`(${escapeRegex(state.query)})`, "gi")
                : null;
            block.innerHTML = excerpts
                .map((excerpt) => {
                    const escaped = escapeHtml(excerpt);
                    return `<p class="search-excerpt">${
                        highlight ? escaped.replace(highlight, "<mark>$1</mark>") : escaped
                    }</p>`;
                })
                .join('<div class="search-excerpt-sep"></div>');

            block.offsetHeight; // commit the collapsed start state
            block.classList.add("shown");
            block.style.maxHeight = `${block.scrollHeight + 1}px`;
        }

        function updateStatus(visible) {
            if (!status) return;
            const filtering =
                Boolean(state.query) || state.tags.size > 0 || state.categories.size > 0;
            if (!filtering) {
                status.hidden = true;
                status.textContent = "";
                return;
            }
            status.hidden = false;
            status.textContent =
                visible === 0
                    ? "No posts match these filters."
                    : `${visible} / ${rows.length} posts`;
        }

        function updateControls(direction) {
            for (const option of options) {
                const group =
                    option.dataset.filterKind === "category" ? state.categories : state.tags;
                const active = group.has(option.dataset.filterValue || "");
                option.classList.toggle("is-active", active);
                option.setAttribute("aria-pressed", String(active));
            }
            for (const button of sortButtons) {
                const active = button.dataset.sort === state.sort;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", String(active));
            }
            if (directionButton) {
                directionButton.textContent = DIRECTION_LABELS[state.sort][direction];
                directionButton.setAttribute(
                    "aria-label",
                    `Sort direction: ${DIRECTION_LABELS[state.sort][direction]}`
                );
            }
            if (resetButton) {
                const dirty =
                    Boolean(state.query) || state.tags.size > 0 || state.categories.size > 0;
                resetButton.disabled = !dirty;
            }
            if (!toggle) return;
            const activeFilters = state.tags.size + state.categories.size;
            toggle.classList.toggle("has-filters", activeFilters > 0);
            toggle.setAttribute(
                "aria-label",
                activeFilters > 0
                    ? `Show filters and sorting (${activeFilters} active)`
                    : "Show filters and sorting"
            );
            if (count) {
                count.textContent = activeFilters > 0 ? String(activeFilters) : "";
                count.hidden = activeFilters === 0;
            }
        }
    },
};

// Kept out of the click handler above so the sort buttons can only ever pick a
// known order.
function isArchiveSort(sort) {
    return Object.prototype.hasOwnProperty.call(ARCHIVE_COMPARATORS, sort);
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function htmlToPlainText(html) {
    try {
        let text = html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(
                /<\/?(p|div|h[1-6]|li|tr|blockquote|pre|section|article|hr|ul|ol|table|figure|details|summary|fieldset|legend|dd|dt|dl|address|form|header|footer|main|nav|aside|figcaption|caption|thead|tbody|tfoot|colgroup|th|td)[^>]*>/gi,
                "\n"
            )
            .replace(/<[^>]*>/g, "");
        // Decode HTML entities using the browser's own parser.
        const ta = document.createElement("textarea");
        ta.innerHTML = text;
        text = ta.value;
        return text.replace(/\n{3,}/g, "\n\n").trim();
    } catch (error) {
        console.error("[search] htmlToPlainText error:", error);
        return html.replace(/<[^>]*>/g, "").trim();
    }
}
