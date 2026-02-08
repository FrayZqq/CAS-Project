(() => {
  "use strict";

  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const isFileProtocol = window.location.protocol === "file:";
  const SERVER_MODE = isLocalHost && !isFileProtocol;
  const DATA_URL = SERVER_MODE ? "/api/timeline-data" : "assets/timeline-data.json";
  const FILTERS = ["All", "Sustainability", "Achievements", "Community", "Facilities", "Academics", "Creativity"];
  const ADMIN_PASSWORD = "admin";
  const PUBLISH_ENDPOINT = document.querySelector('meta[name="publish-endpoint"]')?.content?.trim() || "";
  const TEACHER_UNLOCK_STORAGE_KEY = "kcm.timeline.teacherUnlocked";
  const CUSTOM_STORAGE_KEY = "kcm.timeline.customItems";
  const DELETED_STORAGE_KEY = "kcm.timeline.deletedItems";
  const UPLOAD_ENDPOINT = "/api/upload-image";
  const LOGIN_ENDPOINT = "/api/login";
  const LOGOUT_ENDPOINT = "/api/logout";
  const ME_ENDPOINT = "/api/me";
  const ADD_EVENT_ENDPOINT = "/api/events";
  const DELETE_EVENT_ENDPOINT = "/api/delete";
  const categoryColors = {
    Sustainability: "#28a745",
    Achievements: "#ed6c75",
    Community: "#143256",
    Facilities: "#59cbe8",
    Academics: "#f4b400",
    Creativity: "#b871f2"
  };
  const motionQuery = window.matchMedia("(prefers-reduced-motion: no-preference)");

  const timelineEl = document.getElementById("timeline-list");
  const emptyStateEl = document.querySelector(".empty-state");
  const controls = {
    banner: document.querySelector(".state-banner"),
    retry: document.querySelector('[data-action="retry"]'),
    clear: document.querySelector('[data-action="clear"]'),
    search: document.getElementById("timeline-search"),
    sort: document.querySelector(".sort-toggle"),
    chips: document.querySelector(".filter-chips")
  };
  const adminModal = document.querySelector("[data-admin-modal]");
  const adminControls = document.querySelector("[data-admin-controls]");
  const adminStatus = document.querySelector("[data-admin-status]");
  const adminExportBtn = document.querySelector("[data-admin-export]");
  const adminPublishBtn = document.querySelector("[data-admin-publish]");
  const adminOpenModalBtn = document.querySelector("[data-admin-open-modal]");
  const publishToast = document.getElementById("publish-toast");
  const adminCloseTriggers = document.querySelectorAll("[data-admin-close-modal]");
  const imageFileInput = document.getElementById("admin-image-files");
  const imagePreviewContainer = document.querySelector("[data-image-previews]");
  const publishPasswordInput = document.getElementById("publish-password");
  const teacherLoginButtons = Array.from(document.querySelectorAll("[data-teacher-login]"));
  const teacherMenu = document.querySelector("[data-teacher-menu]");
  const teacherAddEventBtn = document.querySelector("[data-teacher-add-event]");
  const teacherLogoutBtn = document.querySelector("[data-teacher-logout]");
  const teacherModal = document.querySelector("[data-teacher-modal]");
  const teacherLoginForm = document.querySelector("[data-teacher-login-form]");
  const teacherLoginFeedback = document.querySelector("[data-teacher-login-feedback]");
  const teacherPasswordInput = document.getElementById("teacher-password");
  const teacherModalCloseTriggers = Array.from(document.querySelectorAll("[data-teacher-close]"));

let baseItems = [];
let baseMeta = { school: "King's College Murcia", lastUpdated: "" };
let customItems = loadCustomItems();
let deletedIds = loadDeletedIds();
let publishSignature = null;
let currentSignature = null;
let uploadedImages = [];
let adminUnlocked = loadTeacherUnlocked();

  const state = {
    items: [],
    filter: FILTERS[0],
    query: "",
    sort: "oldest",
    yearAnchor: "",
    loaded: false,
    error: false
  };

  let renderQueued = false;
  let hydratingFromHash = false;
  let initialRenderDone = false;
  let pendingYearScroll = "";

  const yearObserver = new IntersectionObserver(handleYearIntersection, {
    rootMargin: "-50% 0px -40% 0px",
    threshold: 0.4
  });

  function init() {
    bindUI();
    syncFilterButtons();
    updateSortToggle();
    applyHashParams();
    hydrateAuthFromServer();
    loadData();
    if (!SERVER_MODE) startUpdatePolling();
    setupAdminPanel();
    exposeHelpers();
  }

  function bindUI() {
    controls.chips.addEventListener("click", (event) => {
      const btn = event.target.closest(".chip");
      if (!btn) return;
      const value = btn.dataset.filter;
      if (!FILTERS.includes(value) || value === state.filter) return;
      updateState({ filter: value });
      syncFilterButtons();
    });

    let searchTimer = null;
    controls.search.addEventListener("input", (event) => {
      const value = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        updateState({ query: value });
      }, 140);
    });

    controls.sort.addEventListener("click", () => {
      const nextSort = state.sort === "newest" ? "oldest" : "newest";
      updateState({ sort: nextSort });
      updateSortToggle();
    });

    controls.retry.addEventListener("click", () => {
      controls.banner.hidden = true;
      loadData();
    });

    controls.clear.addEventListener("click", () => {
      resetState();
    });

    timelineEl.addEventListener("click", (event) => {
      const deleteBtn = event.target.closest(".delete-btn");
      if (deleteBtn) {
        event.stopPropagation();
        const id = deleteBtn.dataset.id;
        if (confirm("Delete this event? This action cannot be undone.")) {
          deleteEventById(id);
        }
        return;
      }
    });

    window.addEventListener("hashchange", () => {
      if (hydratingFromHash) return;
      applyHashParams(true);
    });
  }

  function loadData() {
    timelineEl.setAttribute("aria-busy", "true");
    fetch(buildDataUrl(), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Network error");
        return response.json();
      })
      .then((payload) => {
        baseMeta = {
          school: payload.school || baseMeta.school,
          lastUpdated: payload.lastUpdated || baseMeta.lastUpdated
        };
        baseItems = Array.isArray(payload.items) ? payload.items : [];
        state.items = SERVER_MODE ? baseItems : buildVisibleItems();
        currentSignature = buildPublishSignature(payload);
        state.loaded = true;
        state.error = false;
        controls.banner.hidden = true;
        timelineEl.removeAttribute("aria-busy");
        requestRender(true);
      })
      .catch(() => {
        state.error = true;
        controls.banner.hidden = false;
        timelineEl.removeAttribute("aria-busy");
      });
  }

  function getFilteredItems() {
    if (!state.loaded) return [];
    let items = [...state.items];
    if (state.filter !== "All") {
      items = items.filter((item) => item.categories?.includes(state.filter));
    }
    const query = state.query.trim().toLowerCase();
    if (query) {
      items = items.filter((item) => {
        const haystack = [item.title, item.summary, item.details, (item.keywords || []).join(" ")].join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }
    items.sort((a, b) => {
      const direction = state.sort === "newest" ? -1 : 1;
      return direction * (new Date(a.date) - new Date(b.date));
    });
    return items;
  }

  function renderTimeline(immediate = false) {
    const items = getFilteredItems();
    if (!items.length) {
      yearObserver.disconnect();
      timelineEl.innerHTML = "";
      emptyStateEl.hidden = false;
      return;
    }
    emptyStateEl.hidden = true;

    const fragment = document.createDocumentFragment();
    const yearMap = new Map();
    const years = [];
    items.forEach((item) => {
      if (!yearMap.has(item.year)) {
        yearMap.set(item.year, []);
        years.push(item.year);
      }
      yearMap.get(item.year).push(item);
    });

    years.forEach((year) => {
      const groupItem = document.createElement("li");
      groupItem.className = "timeline-year-group";
      groupItem.dataset.yearGroup = year;

      const header = document.createElement("div");
      header.className = "year-header";
      header.dataset.yearHeader = year;
      header.setAttribute("role", "heading");
      header.setAttribute("aria-level", "2");
      header.textContent = year;
      groupItem.appendChild(header);

      const cardList = document.createElement("ol");
      cardList.className = "timeline-cards";
      cardList.setAttribute("role", "list");
      yearMap.get(year).forEach((item) => cardList.appendChild(buildCard(item)));
      groupItem.appendChild(cardList);
      fragment.appendChild(groupItem);
    });

    if (!immediate && initialRenderDone && motionQuery.matches) {
      const previous = timelineEl.querySelectorAll(".timeline-card");
      previous.forEach((card) => {
        card.classList.remove("fade-scale-enter", "fade-scale-enter-active");
        card.classList.add("fade-scale-exit");
        requestAnimationFrame(() => card.classList.add("fade-scale-exit-active"));
      });
      setTimeout(() => {
        timelineEl.innerHTML = "";
        timelineEl.appendChild(fragment);
        afterTimelineRender();
      }, 220);
    } else {
      timelineEl.innerHTML = "";
      timelineEl.appendChild(fragment);
      afterTimelineRender();
    }

    initialRenderDone = true;
  }

  function afterTimelineRender() {
    observeYearHeaders();
    if (pendingYearScroll) {
      scrollToYear(pendingYearScroll);
      pendingYearScroll = "";
    }
  }

  function buildCard(item) {
    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    li.dataset.year = item.year;

    const article = document.createElement("article");
    article.className = "timeline-card";
    article.dataset.id = item.id;
    const hasSustainability = (item.categories || []).includes("Sustainability");
    article.dataset.sustainability = hasSustainability;
    article.dataset.year = item.year;
    article.dataset.deletable = adminUnlocked ? "true" : "false";
    article.setAttribute("role", "group");
    article.tabIndex = 0;
    const color = categoryColors[item.categories?.[0]] || "#143256";
    article.style.setProperty("--category-color", color);

    const heading = document.createElement("h3");
    heading.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const dateSpan = document.createElement("span");
    dateSpan.textContent = formatDate(item.date);
    meta.appendChild(dateSpan);
    if (hasSustainability) {
      const leaf = document.createElement("span");
      leaf.className = "leaf-icon";
      leaf.innerHTML = '<svg aria-hidden="true"><use href="assets/icons.svg#icon-leaf"></use></svg>';
      meta.appendChild(leaf);
    }

    const summary = document.createElement("p");
    summary.textContent = item.summary;

    const categories = document.createElement("div");
    categories.className = "media-chips";
    (item.categories || []).forEach((cat) => {
      const chip = document.createElement("span");
      chip.className = "category-chip";
      chip.textContent = cat;
      categories.appendChild(chip);
    });

    const mediaRow = document.createElement("div");
    mediaRow.className = "media-chips media-indicators";
    createMediaIndicators(item).forEach((node) => mediaRow.appendChild(node));

    article.appendChild(heading);
    article.appendChild(meta);
    article.appendChild(summary);
    if (categories.childNodes.length) article.appendChild(categories);
    if (mediaRow.childNodes.length) article.appendChild(mediaRow);
    if (adminUnlocked) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.dataset.id = item.id;
      deleteBtn.textContent = "×";
      article.appendChild(deleteBtn);
    }

    li.appendChild(article);
    return li;
  }

  function createMediaIndicators(item) {
    const chips = [];
    const pool = [];
    (item.images || []).forEach((src, index) => {
      pool.push({
        type: "image",
        label: (item.images.length > 1 ? `Image ${index + 1}` : "Image"),
        url: src
      });
    });
    (item.videos || []).forEach((url, index) => {
      pool.push({
        type: "video",
        label: `Video ${index + 1}`,
        url
      });
    });
    (item.links || []).forEach((link) => {
      pool.push({
        type: "link",
        label: link.label || "Link",
        url: link.url
      });
    });

    const visible = pool.slice(0, 2);
    visible.forEach((entry) => {
      const anchor = document.createElement("a");
      anchor.className = "media-chip";
      anchor.href = entry.url;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      anchor.setAttribute("role", "button");
      anchor.innerHTML = `${iconFor(entry.type)}${entry.label}`;
      chips.push(anchor);
    });

    if (pool.length > visible.length) {
      const remainder = document.createElement("span");
      remainder.className = "media-chip media-chip-static";
      remainder.textContent = `+${pool.length - visible.length}`;
      chips.push(remainder);
    }

    return chips;
  }

  function iconFor(type) {
    if (type === "video") return '<svg aria-hidden="true"><use href="assets/icons.svg#icon-play"></use></svg>';
    if (type === "link") return '<svg aria-hidden="true"><use href="assets/icons.svg#icon-link"></use></svg>';
    return '<svg aria-hidden="true"><use href="assets/icons.svg#icon-image"></use></svg>';
  }

  function observeYearHeaders() {
    yearObserver.disconnect();
    timelineEl.querySelectorAll(".year-header").forEach((header) => yearObserver.observe(header));
  }

  function handleYearIntersection(entries) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        const year = entry.target.dataset.yearHeader;
        if (year && state.yearAnchor !== year) {
          state.yearAnchor = year;
          syncHash();
        }
      }
    });
  }

  function scrollToYear(year) {
    const target = timelineEl.querySelector(`[data-year-group="${year}"]`);
    if (!target) return;
    const behavior = motionQuery.matches ? "smooth" : "auto";
    target.scrollIntoView({ behavior, block: "start", inline: "start" });
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
  }

  function updateState(partial) {
    if (hydratingFromHash) return;
    Object.assign(state, partial);
    syncHash();
    requestRender();
  }

  function requestRender(immediate = false) {
    if (immediate) {
      renderTimeline(true);
      return;
    }
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderTimeline();
    });
  }

  function syncFilterButtons() {
    controls.chips.querySelectorAll(".chip").forEach((chip) => {
      const active = chip.dataset.filter === state.filter;
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function updateSortToggle() {
    const isNewest = state.sort === "newest";
    controls.sort.dataset.sort = state.sort;
    controls.sort.querySelector(".sort-label").textContent = isNewest ? "Newest" : "Oldest";
    controls.sort.setAttribute("aria-pressed", isNewest ? "true" : "false");
  }

  function applyHashParams(fromEvent = false) {
    hydratingFromHash = true;
    const hash = window.location.hash.slice(1);
    state.filter = FILTERS[0];
    state.sort = "oldest";
    state.query = "";
    state.yearAnchor = "";
    controls.search.value = "";
    pendingYearScroll = "";

    if (hash) {
      const params = new URLSearchParams(hash);
      const filter = params.get("filter");
      const sort = params.get("sort");
      const query = params.get("q");
      const year = params.get("year");
      if (FILTERS.includes(filter)) state.filter = filter;
      if (sort === "oldest" || sort === "newest") state.sort = sort;
      if (typeof query === "string") {
        state.query = query;
        controls.search.value = query;
      }
      if (year) {
        state.yearAnchor = year;
        pendingYearScroll = year;
      }
    } else if (fromEvent) {
      hydratingFromHash = false;
      requestRender(true);
      return;
    }

    syncFilterButtons();
    updateSortToggle();
    hydratingFromHash = false;
    if (state.loaded) {
      requestRender(true);
    }
  }

  function syncHash() {
    if (hydratingFromHash) return;
    const params = new URLSearchParams();
    if (state.yearAnchor) params.set("year", state.yearAnchor);
    if (state.filter !== "All") params.set("filter", state.filter);
    if (state.query.trim()) params.set("q", state.query.trim());
    if (state.sort !== "oldest") params.set("sort", state.sort);
    const base = `${window.location.pathname}${window.location.search}`;
    const next = params.toString();
    const url = next ? `${base}#${next}` : base;
    history.replaceState(null, "", url);
  }

  function resetState() {
    controls.search.value = "";
    state.filter = "All";
    state.query = "";
    state.sort = "oldest";
    state.yearAnchor = "";
    syncFilterButtons();
    updateSortToggle();
    syncHash();
    requestRender(true);
  }

  function exposeHelpers() {
    window.KCM = window.KCM || {};
    window.KCM.timeline = {
      setFilter: (value) => {
        if (FILTERS.includes(value)) {
          updateState({ filter: value });
          syncFilterButtons();
        }
      },
      setQuery: (value = "") => {
        controls.search.value = value;
        updateState({ query: value });
      },
      setSort: (value) => {
        if (value === "newest" || value === "oldest") {
          updateState({ sort: value });
          updateSortToggle();
        }
      },
      openById: (id) => {
        const target = timelineEl.querySelector(`.timeline-card[data-id="${id}"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.focus();
        }
      },
      reset: () => resetState()
    };
  }

  function setupAdminPanel() {
    const adminForm = document.querySelector("[data-admin-form]");
    if (!adminForm || !adminModal) return;

    const openAdminModal = () => {
      if (!adminUnlocked) {
        openTeacherModal();
        return;
      }
      adminForm.reset();
      uploadedImages = [];
      renderImagePreviews();
      adminModal.hidden = false;
      adminStatus && (adminStatus.hidden = true);
    };

    if (adminOpenModalBtn) {
      adminOpenModalBtn.addEventListener("click", openAdminModal);
    }

    if (teacherAddEventBtn) {
      teacherAddEventBtn.addEventListener("click", openAdminModal);
    }

    adminCloseTriggers.forEach((btn) => {
      btn.addEventListener("click", () => {
        adminModal.hidden = true;
        adminForm.reset();
        uploadedImages = [];
        renderImagePreviews();
      });
    });

    if (adminExportBtn) {
      adminExportBtn.addEventListener("click", () => {
        if (!state.loaded) {
          if (adminStatus) {
            adminStatus.textContent = "Load the timeline before exporting.";
            adminStatus.classList.add("text-danger");
            adminStatus.hidden = false;
          }
          return;
        }
        const payload = buildExportPayload();
        downloadJson("timeline-data.json", payload);
        if (adminStatus) {
          adminStatus.textContent = "Downloaded timeline-data.json. Replace assets/timeline-data.json in GitHub and push.";
          adminStatus.classList.remove("text-danger");
          adminStatus.hidden = false;
          setTimeout(() => (adminStatus.hidden = true), 4000);
        }
      });
    }

    if (adminPublishBtn) {
      adminPublishBtn.addEventListener("click", () => {
        if (!PUBLISH_ENDPOINT) {
          if (adminStatus) {
            adminStatus.textContent = "Publish endpoint not set. Add it to the meta tag in index.html.";
            adminStatus.classList.add("text-danger");
            adminStatus.hidden = false;
          }
          return;
        }
        const password = (publishPasswordInput?.value || "").trim();
        if (!password) {
          if (adminStatus) {
            adminStatus.textContent = "Enter the publish password.";
            adminStatus.classList.add("text-danger");
            adminStatus.hidden = false;
          }
          return;
        }
        const payload = buildExportPayload();
        publishTimeline(payload, password);
      });
    }

    if (imageFileInput) {
      imageFileInput.addEventListener("change", (event) => {
        const files = Array.from(event.target.files || []);
        files.forEach((file) => {
          if (!file.type.startsWith("image/")) return;
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target.result;
            const entry = { url: dataUrl, name: file.name };
            uploadedImages.push(entry);
            renderImagePreviews();
            uploadImageToLocalServer(dataUrl, file.name)
              .then((url) => {
                if (url) {
                  entry.url = url;
                  renderImagePreviews();
                }
              })
              .catch(() => {
                // ignore: keep data URL fallback
              });
          };
          reader.readAsDataURL(file);
        });
        imageFileInput.value = "";
      });
    }
    renderImagePreviews();

    wireTeacherAuthUI();
    applyTeacherAuthUI();

    adminForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const fields = {
        title: document.getElementById("admin-title").value.trim(),
        date: document.getElementById("admin-date").value,
        summary: document.getElementById("admin-summary").value.trim(),
        details: document.getElementById("admin-details").value.trim(),
        categories: Array.from(adminForm.querySelectorAll(".category-checkboxes input:checked")).map((input) => input.value),
        images: splitList(document.getElementById("admin-images").value),
        videos: splitList(document.getElementById("admin-videos").value),
        links: parseLinks(document.getElementById("admin-links").value),
        keywords: splitList(document.getElementById("admin-keywords").value)
      };

      if (!fields.title || !fields.date || !fields.summary || !fields.details || !fields.categories.length) {
        if (adminStatus) {
          adminStatus.textContent = "Fill title, date, summary, details, and at least one category.";
          adminStatus.classList.add("text-danger");
          adminStatus.hidden = false;
        }
        return;
      }

      const payload = {
        ...fields,
        images: [...fields.images, ...uploadedImages.map((entry) => entry.url)]
      };

      if (SERVER_MODE) {
        addEventOnServer(payload)
          .then((ok) => {
            if (!ok) {
              if (adminStatus) {
                adminStatus.textContent = "Unable to save to server. Are you logged in?";
                adminStatus.classList.add("text-danger");
                adminStatus.hidden = false;
              }
              return;
            }

            adminForm.reset();
            uploadedImages = [];
            renderImagePreviews();
            adminModal.hidden = true;
            loadData();
            if (adminStatus) {
              adminStatus.textContent = "Event added!";
              adminStatus.classList.remove("text-danger");
              adminStatus.hidden = false;
              setTimeout(() => (adminStatus.hidden = true), 2000);
            }
          })
          .catch(() => {
            if (adminStatus) {
              adminStatus.textContent = "Unable to save to server.";
              adminStatus.classList.add("text-danger");
              adminStatus.hidden = false;
            }
          });
        return;
      }

      const newItem = {
        id: `custom-${Date.now()}`,
        date: fields.date,
        year: new Date(fields.date).getFullYear(),
        title: fields.title,
        summary: fields.summary,
        categories: fields.categories,
        details: fields.details,
        images: payload.images,
        videos: fields.videos,
        links: fields.links,
        keywords: fields.keywords
      };

      customItems.push(newItem);
      saveCustomItems(customItems);
      state.items = buildVisibleItems();
      requestRender(true);
      adminForm.reset();
      uploadedImages = [];
      renderImagePreviews();
      adminModal.hidden = true;
      if (adminStatus) {
        adminStatus.textContent = "Event added! (Not published yet)";
        adminStatus.classList.remove("text-danger");
        adminStatus.hidden = false;
        setTimeout(() => (adminStatus.hidden = true), 2000);
      }
    });
  }

  function wireTeacherAuthUI() {
    if (teacherLoginButtons.length) {
      teacherLoginButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (adminUnlocked) return;
          openTeacherModal();
        });
      });
    }

    if (teacherLogoutBtn) {
      teacherLogoutBtn.addEventListener("click", () => {
        if (SERVER_MODE) {
          logoutFromServer().finally(() => setAdminUnlocked(false));
        } else {
          setAdminUnlocked(false);
        }
      });
    }

    if (teacherModalCloseTriggers.length) {
      teacherModalCloseTriggers.forEach((btn) => {
        btn.addEventListener("click", closeTeacherModal);
      });
    }

    if (teacherLoginForm) {
      teacherLoginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const pass = (teacherPasswordInput?.value || "").trim();
        if (!pass) return;

        if (SERVER_MODE) {
          loginToServer(pass)
            .then((ok) => {
              if (ok) {
                if (teacherLoginFeedback) teacherLoginFeedback.hidden = true;
                closeTeacherModal();
                setAdminUnlocked(true);
              } else if (teacherLoginFeedback) {
                teacherLoginFeedback.hidden = false;
              }
            })
            .catch(() => {
              if (teacherLoginFeedback) teacherLoginFeedback.hidden = false;
            });
          return;
        }

        if (pass === ADMIN_PASSWORD) {
          if (teacherLoginFeedback) teacherLoginFeedback.hidden = true;
          closeTeacherModal();
          setAdminUnlocked(true);
        } else if (teacherLoginFeedback) {
          teacherLoginFeedback.hidden = false;
        }
      });
    }

    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (teacherModal && !teacherModal.hidden) {
        closeTeacherModal();
      }
    });
  }

  function openTeacherModal() {
    if (!teacherModal) return;
    if (teacherLoginFeedback) teacherLoginFeedback.hidden = true;
    if (teacherPasswordInput) teacherPasswordInput.value = "";
    teacherModal.hidden = false;
    setTimeout(() => teacherPasswordInput?.focus(), 0);
  }

  function closeTeacherModal() {
    if (!teacherModal) return;
    teacherModal.hidden = true;
  }

  function applyTeacherAuthUI() {
    const lockedCard = document.querySelector("[data-admin-locked]");
    if (lockedCard) lockedCard.hidden = adminUnlocked;
    if (adminControls) adminControls.hidden = !adminUnlocked;

    if (teacherMenu) teacherMenu.hidden = !adminUnlocked;
    if (teacherLoginButtons.length) {
      teacherLoginButtons.forEach((btn) => (btn.hidden = adminUnlocked));
    }

    if (state.loaded) requestRender(true);
  }

  function setAdminUnlocked(nextValue) {
    adminUnlocked = Boolean(nextValue);
    saveTeacherUnlocked(adminUnlocked);
    applyTeacherAuthUI();
  }

  function loadTeacherUnlocked() {
    try {
      return sessionStorage.getItem(TEACHER_UNLOCK_STORAGE_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  function saveTeacherUnlocked(value) {
    try {
      sessionStorage.setItem(TEACHER_UNLOCK_STORAGE_KEY, value ? "true" : "false");
    } catch (error) {
      // ignore storage errors (private mode, quota, etc.)
    }
  }

  function hydrateAuthFromServer() {
    if (!SERVER_MODE) return;
    fetch(ME_ENDPOINT, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (payload && payload.ok) {
          adminUnlocked = Boolean(payload.loggedIn);
          saveTeacherUnlocked(adminUnlocked);
          applyTeacherAuthUI();
        }
      })
      .catch(() => {
        // ignore
      });
  }

  async function loginToServer(password) {
    try {
      const response = await fetch(LOGIN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!response.ok) return false;
      const payload = await response.json();
      return Boolean(payload?.ok);
    } catch {
      return false;
    }
  }

  async function logoutFromServer() {
    try {
      await fetch(LOGOUT_ENDPOINT, { method: "POST" });
    } catch {
      // ignore
    }
  }

  async function addEventOnServer(payload) {
    try {
      const response = await fetch(ADD_EVENT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) return false;
      const body = await response.json();
      return Boolean(body?.ok);
    } catch {
      return false;
    }
  }

  async function deleteEventOnServer(id) {
    try {
      const response = await fetch(DELETE_EVENT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!response.ok) return false;
      const body = await response.json();
      return Boolean(body?.ok);
    } catch {
      return false;
    }
  }

  async function uploadImageToLocalServer(dataUrl, filename) {
    if (!dataUrl || typeof dataUrl !== "string") return "";
    if (window.location.protocol === "file:") return "";

    try {
      const response = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, filename })
      });
      if (!response.ok) return "";
      const payload = await response.json();
      if (payload?.ok && typeof payload.url === "string") return payload.url;
      return "";
    } catch (error) {
      return "";
    }
  }

  function renderImagePreviews() {
    if (!imagePreviewContainer) return;
    imagePreviewContainer.innerHTML = "";
    if (!uploadedImages.length) {
      const emptyMsg = document.createElement("p");
      emptyMsg.className = "text-muted small mb-0";
      emptyMsg.textContent = "No uploaded images yet.";
      imagePreviewContainer.appendChild(emptyMsg);
      return;
    }
    uploadedImages.forEach((item, index) => {
      const thumb = document.createElement("div");
      thumb.className = "upload-thumb";
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.name || `Upload ${index + 1}`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", () => {
        uploadedImages.splice(index, 1);
        renderImagePreviews();
      });
      thumb.appendChild(img);
      thumb.appendChild(removeBtn);
      imagePreviewContainer.appendChild(thumb);
    });
  }

  function splitList(value) {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function parseLinks(value) {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, url] = line.split("|").map((part) => part?.trim());
        if (label && url) {
          return { label, url };
        }
        return null;
      })
      .filter(Boolean);
  }

  function loadCustomItems() {
    try {
      const stored = localStorage.getItem(CUSTOM_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      return [];
    }
  }

  function saveCustomItems(items) {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(items));
  }

  function loadDeletedIds() {
    try {
      const stored = localStorage.getItem(DELETED_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      return [];
    }
  }

  function saveDeletedIds(ids) {
    localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(ids));
  }

  function buildVisibleItems() {
    const baseVisible = baseItems.filter((item) => !deletedIds.includes(item.id));
    return [...baseVisible, ...customItems];
  }

  function deleteEventById(id) {
    if (SERVER_MODE) {
      deleteEventOnServer(id).then((ok) => {
        if (ok) loadData();
      });
      return;
    }
    const customIndex = customItems.findIndex((item) => item.id === id);
    if (customIndex > -1) {
      customItems.splice(customIndex, 1);
      saveCustomItems(customItems);
    } else {
      if (!deletedIds.includes(id)) {
        deletedIds.push(id);
        saveDeletedIds(deletedIds);
      }
    }
    state.items = buildVisibleItems();
    requestRender(true);
  }

  function publishTimeline(payload, password) {
    if (adminStatus) {
      adminStatus.textContent = "Publishing...";
      adminStatus.classList.remove("text-danger");
      adminStatus.hidden = false;
    }
    fetch(PUBLISH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, data: payload })
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          const message = data?.error || "Publish failed.";
          if (adminStatus) {
            adminStatus.textContent = message;
            adminStatus.classList.add("text-danger");
            adminStatus.hidden = false;
          }
          return;
        }
        showPublishSuccess(payload);
      })
      .catch(() => {
        if (adminStatus) {
          adminStatus.textContent = "Publish failed. Check the publish server.";
          adminStatus.classList.add("text-danger");
          adminStatus.hidden = false;
        }
        showToast("Publish failed. Check the publish server.", true);
      });
  }

  function showPublishSuccess(payload) {
    if (adminStatus) {
      adminStatus.textContent = "Published to GitHub. It can take 1-2 minutes to update the public site.";
      adminStatus.classList.remove("text-danger");
      adminStatus.hidden = false;
      setTimeout(() => (adminStatus.hidden = true), 6000);
    }
    showToast("Published to GitHub. Updating public site (about 1-2 minutes).");
    clearLocalEdits();
    publishSignature = buildPublishSignature(payload);
    pollForPublishUpdate(12, 10000);
  }

  function showToast(message, isError = false) {
    if (!publishToast) return;
    publishToast.textContent = message;
    publishToast.classList.toggle("is-error", Boolean(isError));
    publishToast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      publishToast.hidden = true;
    }, 6000);
  }

  function clearLocalEdits() {
    customItems = [];
    deletedIds = [];
    saveCustomItems(customItems);
    saveDeletedIds(deletedIds);
    state.items = baseItems;
    requestRender(true);
    currentSignature = buildPublishSignature({ lastUpdated: baseMeta.lastUpdated, items: baseItems });
  }

  function buildPublishSignature(payload) {
    if (!payload) return null;
    return `${payload.lastUpdated || ""}|${Array.isArray(payload.items) ? payload.items.length : 0}`;
  }

  function pollForPublishUpdate(attempts, intervalMs) {
    if (!publishSignature) return;
    let remaining = attempts;
    const poll = () => {
      remaining -= 1;
      fetch(`assets/timeline-data.json?ts=${Date.now()}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          const signature = buildPublishSignature(data);
          if (signature && signature === publishSignature) {
            showToast("Public site updated. Reloading…");
            setTimeout(() => window.location.reload(), 1000);
          }
        })
        .catch(() => {
          // ignore
        })
        .finally(() => {
          if (remaining > 0) {
            setTimeout(poll, intervalMs);
          }
        });
    };
    setTimeout(poll, intervalMs);
  }

  function buildDataUrl() {
    return SERVER_MODE ? DATA_URL : `${DATA_URL}?ts=${Date.now()}`;
  }

  function startUpdatePolling() {
    setInterval(() => {
      if (!state.loaded) return;
      if (customItems.length || deletedIds.length) return; // Don't overwrite local edits.
      fetch(`${DATA_URL}?ts=${Date.now()}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          const signature = buildPublishSignature(data);
          if (signature && currentSignature && signature !== currentSignature) {
            showToast("New updates detected. Reloading…");
            setTimeout(() => window.location.reload(), 1000);
          }
        })
        .catch(() => {
          // ignore
        });
    }, 120000);
  }

  function buildExportPayload() {
    const items = buildVisibleItems()
      .map((item) => normalizeItemForExport(item))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const today = new Date().toISOString().slice(0, 10);
    return {
      school: baseMeta.school || "King's College Murcia",
      lastUpdated: today,
      items
    };
  }

  function normalizeItemForExport(item) {
    const categories = Array.isArray(item.categories) ? item.categories : [];
    return {
      id: item.id,
      date: item.date,
      year: item.year || new Date(item.date).getFullYear(),
      title: item.title,
      summary: item.summary,
      categories,
      sustainability: categories.includes("Sustainability"),
      details: item.details,
      images: Array.isArray(item.images) ? item.images : [],
      videos: Array.isArray(item.videos) ? item.videos : [],
      links: Array.isArray(item.links) ? item.links : [],
      keywords: Array.isArray(item.keywords) ? item.keywords : []
    };
  }

  function downloadJson(filename, payload) {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  init();
})();
