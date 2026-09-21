mixins.search = {
    data() {
        return { rawSearch: "", postsData: [] };
    },
    mounted() {
        const raw = window.__POSTS_DATA__;
        if (raw && raw.length) {
            try {
                this.postsData = raw.map((post) => ({
                    ...post,
                    plainContent: this.htmlToPlainText(post.content),
                }));
            } catch (e) {
                console.error("[search] Failed to process posts data:", e);
                this.postsData = [];
            }
        } else {
            console.warn("[search] window.__POSTS_DATA__ not available!");
            this.postsData = [];
        }
        this.searchResults = document.getElementById("search-results");
    },
    watch: {
        search(value) {
            try {
                const timeline = this.$refs.timeline;

                if (!value) {
                    if (timeline) timeline.style.display = "";
                    if (this.searchResults)
                        this.searchResults.style.display = "none";
                    if (timeline) {
                        for (let i of timeline.childNodes) {
                            if (i.nodeType === 1) {
                                i.style.opacity = 1;
                                i.style.visibility = "visible";
                                i.style.marginTop = 0;
                            }
                        }
                    }
                    return;
                }

                if (timeline) timeline.style.display = "none";
                if (this.searchResults)
                    this.searchResults.style.display = "";

                const results = this.buildResults(value);
                this.renderResults(results);
            } catch (e) {
                console.error("[search] watcher error:", e);
            }
        },
    },
    computed: {
        search() {
            return this.rawSearch.toLowerCase().replace(/\s+/g, "");
        },
    },
    methods: {
        buildResults(strippedQuery) {
            const results = [];
            if (!this.postsData || !this.postsData.length) return results;

            for (const post of this.postsData) {
                const titleNorm = post.title
                    .toLowerCase()
                    .replace(/\s+/g, "");
                const titleMatch = titleNorm.includes(strippedQuery);

                const lines = post.plainContent.split("\n");
                const matchIndices = [];
                for (let i = 0; i < lines.length; i++) {
                    const lineNorm = lines[i]
                        .toLowerCase()
                        .replace(/\s+/g, "");
                    if (lineNorm.includes(strippedQuery)) {
                        matchIndices.push(i);
                    }
                }

                // Merge overlapping / adjacent match ranges (±2 context each)
                const contentMatches = [];
                if (matchIndices.length > 0) {
                    let rStart = Math.max(0, matchIndices[0] - 2);
                    let rEnd = Math.min(lines.length - 1, matchIndices[0] + 2);

                    for (let j = 1; j < matchIndices.length; j++) {
                        const mStart = Math.max(0, matchIndices[j] - 2);
                        const mEnd = Math.min(
                            lines.length - 1,
                            matchIndices[j] + 2
                        );
                        // Merge if ranges overlap or touch (gap ≤ 1 line)
                        if (mStart <= rEnd + 1) {
                            rEnd = Math.max(rEnd, mEnd);
                        } else {
                            const excerpt = lines
                                .slice(rStart, rEnd + 1)
                                .map((l) => l.trim())
                                .filter((l) => l.length > 0)
                                .join("\n");
                            if (excerpt) contentMatches.push(excerpt);
                            rStart = mStart;
                            rEnd = mEnd;
                        }
                    }
                    // Flush last range
                    const excerpt = lines
                        .slice(rStart, rEnd + 1)
                        .map((l) => l.trim())
                        .filter((l) => l.length > 0)
                        .join("\n");
                    if (excerpt) contentMatches.push(excerpt);
                }

                if (titleMatch || contentMatches.length > 0) {
                    results.push({
                        title: post.title,
                        path: post.path,
                        date: post.date,
                        categories: post.categories || [],
                        tags: post.tags || [],
                        titleMatch,
                        contentMatches,
                    });
                }
            }

            return results;
        },

        renderResults(results) {
            if (!this.searchResults) return;

            if (results.length === 0) {
                this.searchResults.innerHTML =
                    '<div class="search-empty">No matching posts found</div>';
                return;
            }

            const rawQuery = this.rawSearch.trim();
            let html = "";

            for (const result of results) {
                html += '<div class="search-result">';
                html += `<div class="search-result-date">${this.escapeHtml(result.date)}</div>`;
                html += `<a href="${result.path}"><h3>${this.escapeHtml(result.title)}</h3></a>`;

                if (result.categories.length > 0 || result.tags.length > 0) {
                    html += '<div class="info">';
                    if (result.categories.length > 0) {
                        html += `<span class="category"><a href="${result.categories[0].path}"><span class="icon"><i class="fa-solid fa-bookmark fa-fw"></i></span>${this.escapeHtml(result.categories[0].name)}</a></span>`;
                    }
                    if (result.tags.length > 0) {
                        html +=
                            '<span class="tags"><span class="icon"><i class="fa-solid fa-tags fa-fw"></i></span>';
                        for (const tag of result.tags) {
                            html += `<span class="tag"><a href="${tag.path}" data-color-key="${this.escapeHtml(tag.name)}" data-color-prop="color">${this.escapeHtml(tag.name)}</a></span>`;
                        }
                        html += "</span>";
                    }
                    html += "</div>";
                }

                if (result.contentMatches.length > 0) {
                    html += '<div class="search-excerpts">';
                    const excerptsHtml = result.contentMatches.map(
                        (excerpt) => {
                            let escaped = this.escapeHtml(excerpt);
                            if (rawQuery) {
                                const regex = new RegExp(
                                    `(${this.escapeRegex(rawQuery)})`,
                                    "gi"
                                );
                                escaped = escaped.replace(
                                    regex,
                                    "<mark>$1</mark>"
                                );
                            }
                            return `<p class="search-excerpt">${escaped}</p>`;
                        }
                    );
                    html += excerptsHtml.join(
                        '<div class="search-excerpt-sep"></div>'
                    );
                    html += "</div>";
                }

                html += "</div>";
            }

            this.searchResults.innerHTML = html;
            // Results are built in the browser, so colors.js never saw these.
            if (window.applyTagColors) window.applyTagColors(this.searchResults);
        },

        escapeHtml(text) {
            const div = document.createElement("div");
            div.textContent = text;
            return div.innerHTML;
        },

        escapeRegex(str) {
            return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        },

        htmlToPlainText(html) {
            try {
                let text = html
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(
                        /<\/?(p|div|h[1-6]|li|tr|blockquote|pre|section|article|hr|ul|ol|table|figure|details|summary|fieldset|legend|dd|dt|dl|address|form|header|footer|main|nav|aside|figcaption|caption|thead|tbody|tfoot|colgroup|th|td)[^>]*>/gi,
                        "\n"
                    )
                    .replace(/<[^>]*>/g, "");
                // Decode HTML entities using browser DOM
                const ta = document.createElement("textarea");
                ta.innerHTML = text;
                text = ta.value;
                return text.replace(/\n{3,}/g, "\n\n").trim();
            } catch (e) {
                console.error("[search] htmlToPlainText error:", e);
                return html.replace(/<[^>]*>/g, "").trim();
            }
        },
    },
};
