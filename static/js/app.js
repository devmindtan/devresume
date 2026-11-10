/* ============================================================
       DevResume Studio — Application Logic
       - Quản lý state + UI
       - Phân trang A4 theo "chunk" (an toàn khi in / xuất PDF)
       ============================================================ */

    const DEFAULT_SECTIONS = [
      { id: "summary", title: "SUMMARY", enabled: true, icon: "terminal" },
      { id: "skills", title: "TECHNOLOGY & EXPERIENCE", enabled: true, icon: "cpu" },
      { id: "experience", title: "WORK EXPERIENCE", enabled: true, icon: "layers" },
      { id: "projects", title: "FEATURED PROJECTS", enabled: true, icon: "folder-git" },
      { id: "education", title: "EDUCATION & CERTIFICATIONS", enabled: true, icon: "graduation-cap" }
    ];

    /* Dữ liệu nền tối thiểu. Nội dung thật được tải từ API /api/templates. */
    const FALLBACK_PROFILE = {
      fullName: "", title: "", email: "", phone: "", github: "",
      linkedin: "", portfolio: "", location: "", summary: "",
      eduDegree: "", eduSchool: "", eduTime: "", eduGpa: "", certifications: ""
    };

    const FALLBACK_STYLING = {
      accentColor: "#0f766e",
      fontFamily: "font-sans",
      density: "normal",
      showSeparators: true,
      pillTags: true,
      showPageNumbers: true
    };

    function createBaseResumeData() {
      return {
        profile: { ...FALLBACK_PROFILE },
        sections: deepClone(DEFAULT_SECTIONS),
        skills: [],
        experiences: [],
        projects: [],
        styling: { ...FALLBACK_STYLING }
      };
    }

    /* Khoảng cách (px) được tính trực tiếp vào chiều cao chunk khi đo */
    const DENSITY = {
      compact: { pad: "px-7 py-6", gap: 8, inner: 4, heading: 3, bullet: 2 },
      normal: { pad: "p-8", gap: 12, inner: 6, heading: 5, bullet: 3 },
      relaxed: { pad: "px-10 py-10", gap: 18, inner: 9, heading: 7, bullet: 4 }
    };

    const DEFAULT_TEMPLATE_SLUG = "fullstack";

    let resumeData = createBaseResumeData();
    let currentTemplate = { slug: DEFAULT_TEMPLATE_SLUG, name: "Fullstack Web", description: "", order: 1 };
    let currentZoom = 1;
    let renderTimer = null;
    let toastTimer = null;
    let saveTimer = null;
    let saveInFlight = false;
    let saveQueued = false;

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    /* ----------------------------------------------------
       HELPERS
    ---------------------------------------------------- */
    function deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }

    function escapeHTML(str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderMultiPageResume, 80);
    }

    function getCurrentSlug() {
      if (currentTemplate && currentTemplate.slug) return currentTemplate.slug;
      const select = $("#presetSelect");
      return select && select.value ? select.value : null;
    }

    function scheduleAutoSave() {
      if (!getCurrentSlug()) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveCurrentTemplate, 800);
    }

    async function flushAutoSave() {
      if (!getCurrentSlug()) return;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await saveCurrentTemplate();
        return;
      }
      while (saveInFlight || saveQueued) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }

    function markChanged({ render = "debounced", save = true } = {}) {
      if (render === "debounced") scheduleRender();
      else if (render === "now") renderMultiPageResume();
      if (save) scheduleAutoSave();
    }

    async function saveCurrentTemplate() {
      const slug = getCurrentSlug();
      if (!slug) return;
      if (!currentTemplate || currentTemplate.slug !== slug) {
        currentTemplate = { ...(currentTemplate || {}), slug, name: (currentTemplate && currentTemplate.name) || slug, description: (currentTemplate && currentTemplate.description) || "", order: (currentTemplate && currentTemplate.order) || 0 };
      }
      if (saveInFlight) {
        saveQueued = true;
        return;
      }

      saveInFlight = true;
      try {
        const payload = {
          name: currentTemplate.name || "Preset JD",
          description: currentTemplate.description || "",
          profile: resumeData.profile,
          sections: resumeData.sections,
          skills: resumeData.skills,
          experiences: resumeData.experiences,
          projects: resumeData.projects,
          styling: resumeData.styling
        };
        await fetchJSON(`/api/templates/${encodeURIComponent(slug)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        showToast("Không tự lưu được preset");
      } finally {
        saveInFlight = false;
        if (saveQueued) {
          saveQueued = false;
          scheduleAutoSave();
        }
      }
    }

    function showToast(msg) {
      const toast = $("#toast");
      const msgEl = $("#toast-message");
      if (!toast || !msgEl) return;
      msgEl.textContent = msg;
      toast.classList.remove("translate-y-10", "opacity-0");
      toast.classList.add("translate-y-0", "opacity-100");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.add("translate-y-10", "opacity-0");
        toast.classList.remove("translate-y-0", "opacity-100");
      }, 2200);
    }

    function normalizeResumeData(raw) {
      const data = createBaseResumeData();
      if (!raw || typeof raw !== "object") return data;

      data.profile = { ...data.profile, ...(raw.profile || {}) };
      data.styling = { ...data.styling, ...(raw.styling || {}) };

      if (Array.isArray(raw.sections) && raw.sections.length) {
        const seen = new Set();
        const sections = raw.sections
          .filter(sec => sec && DEFAULT_SECTIONS.some(def => def.id === sec.id))
          .map(sec => {
            const def = DEFAULT_SECTIONS.find(item => item.id === sec.id);
            seen.add(sec.id);
            return {
              ...def,
              ...sec,
              enabled: sec.enabled !== false,
              title: sec.title || def.title,
              icon: sec.icon || def.icon
            };
          });
        DEFAULT_SECTIONS.forEach(def => {
          if (!seen.has(def.id)) sections.push({ ...def, enabled: false });
        });
        data.sections = sections;
      }

      if (Array.isArray(raw.skills)) {
        data.skills = raw.skills.map((group, idx) => ({
          id: group.id || `cat-${idx}`,
          categoryName: group.categoryName || "Technology Group",
          skills: Array.isArray(group.skills)
            ? group.skills.map(skill => (
                typeof skill === "string"
                  ? { name: skill, description: "", enabled: true }
                  : { name: skill.name || "", description: skill.description || "", enabled: skill.enabled !== false }
              ))
            : []
        }));
      }

      if (Array.isArray(raw.experiences)) {
        data.experiences = raw.experiences.map((exp, idx) => ({
          id: exp.id || `exp-${idx}`,
          enabled: exp.enabled !== false,
          company: exp.company || "",
          role: exp.role || "",
          time: exp.time || "",
          location: exp.location || "",
          bullets: Array.isArray(exp.bullets)
            ? exp.bullets.map(String)
            : String(exp.bullets || "").split("\n").filter(Boolean)
        }));
      }

      if (Array.isArray(raw.projects)) {
        data.projects = raw.projects.map((proj, idx) => ({
          id: proj.id || `proj-${idx}`,
          enabled: proj.enabled !== false,
          name: proj.name || "",
          role: proj.role || "",
          time: proj.time || "",
          teamType: proj.teamType || "Individual Project",
          link: proj.link || "",
          technologies: Array.isArray(proj.technologies)
            ? proj.technologies.map(String)
            : String(proj.technologies || "").split(",").map(t => t.trim()).filter(Boolean),
          bullets: Array.isArray(proj.bullets)
            ? proj.bullets.map(String)
            : String(proj.bullets || "").split("\n").filter(Boolean)
        }));
      }

      return data;
    }

    /* ----------------------------------------------------
       INIT & TEMPLATE LOADING
    ---------------------------------------------------- */

    async function fetchJSON(url, options = {}) {
      const response = await fetch(url, {
        ...options,
        headers: { Accept: "application/json", ...(options.headers || {}) }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    }

    function refreshAllViews() {
      loadProfileInputs();
      syncStyleControls();
      renderSectionTitlesConfig();
      renderSkillsConfig();
      renderProjectsConfig();
      renderExperienceConfig();
      renderMultiPageResume();
      if (window.lucide) lucide.createIcons();
    }

    async function loadTemplateList() {
      const select = $("#presetSelect");
      if (!select) return [];

      try {
        const templates = await fetchJSON("/api/templates");
        select.innerHTML = templates
          .map(item => `<option value="${escapeHTML(item.slug)}" class="bg-slate-900">${escapeHTML(item.name)}</option>`)
          .join("");
        return templates;
      } catch (err) {
        select.innerHTML = '<option value="" class="bg-slate-900">Không tải được template</option>';
        showToast("Không tải được danh sách template");
        return [];
      }
    }

    async function loadTemplate(slug) {
      const select = $("#presetSelect");
      try {
        const raw = await fetchJSON(`/api/templates/${encodeURIComponent(slug)}`);
        currentTemplate = {
          slug: raw.slug,
          name: raw.name || slug,
          description: raw.description || "",
          order: raw.order || 0
        };
        resumeData = normalizeResumeData(raw);
        refreshAllViews();
        if (select && select.value !== slug) select.value = slug;
        return true;
      } catch (err) {
        showToast(`Không tải được template "${slug}"`);
        if (select && select.value !== slug) select.value = slug;
        return false;
      }
    }

    async function switchTemplate(slug) {
      if (!slug) return;
      await flushAutoSave();
      await loadTemplate(slug);
    }

    async function createPresetFromCurrent() {
      const suggested = resumeData.profile.fullName
        ? `Preset ${resumeData.profile.fullName}`
        : "Preset JD";
      const input = window.prompt("Tên preset JD mới:", suggested);
      if (input === null) return;

      const name = input.trim() || "Preset JD";
      try {
        const created = await fetchJSON("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: "Preset tạo từ CV hiện tại",
            profile: resumeData.profile,
            sections: resumeData.sections,
            skills: resumeData.skills,
            experiences: resumeData.experiences,
            projects: resumeData.projects,
            styling: resumeData.styling
          })
        });

        currentTemplate = {
          slug: created.slug,
          name: created.name,
          description: created.description || "",
          order: created.order || 0
        };
        await loadTemplateList();
        const select = $("#presetSelect");
        if (select) select.value = created.slug;
        showToast(`Đã lưu preset "${created.name}"`);
      } catch (err) {
        showToast("Không lưu được preset mới");
      }
    }

    async function renameCurrentPreset() {
      const slug = getCurrentSlug();
      if (!slug) {
        showToast("Chưa có preset để đổi tên");
        return;
      }

      const input = window.prompt("Tên preset mới:", currentTemplate.name || "");
      if (input === null) return;

      const name = input.trim();
      if (!name) {
        showToast("Tên preset không được để trống");
        return;
      }

      currentTemplate.name = name;
      markChanged({ render: "none", save: true });
      await flushAutoSave();
      await loadTemplateList();
      const select = $("#presetSelect");
      if (select) select.value = slug;
      showToast(`Đã đổi tên preset thành "${name}"`);
    }

    window.addEventListener("DOMContentLoaded", async () => {
      await loadTemplateList();
      const loaded = await loadTemplate(DEFAULT_TEMPLATE_SLUG);
      if (!loaded) {
        currentTemplate = { slug: null, name: "", description: "", order: 0 };
        resumeData = normalizeResumeData(createBaseResumeData());
        refreshAllViews();
      }
      waitForFonts();
    });

    function waitForFonts() {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => renderMultiPageResume());
      }
      window.addEventListener("load", () => renderMultiPageResume());
    }

    /* ----------------------------------------------------
       TAB NAVIGATION
    ---------------------------------------------------- */
    function switchTab(tabId) {
      $$(".tab-content").forEach(el => el.classList.add("hidden"));
      $$(".tab-btn").forEach(btn => {
        btn.classList.remove("text-emerald-400", "bg-slate-800", "font-semibold");
        btn.classList.add("text-slate-400");
      });

      const activePanel = $(`#tab-panel-${tabId}`);
      const activeBtn = $(`#tab-btn-${tabId}`);
      if (activePanel) activePanel.classList.remove("hidden");
      if (activeBtn) {
        activeBtn.classList.add("text-emerald-400", "bg-slate-800", "font-semibold");
        activeBtn.classList.remove("text-slate-400");
      }
      if (window.lucide) lucide.createIcons();
    }

    /* ----------------------------------------------------
       SECTION TITLES & ORDERING
    ---------------------------------------------------- */
    function renderSectionTitlesConfig() {
      const container = $("#section-titles-container");
      if (!container) return;

      container.innerHTML = resumeData.sections.map((sec, idx) => `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 transition">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" ${sec.enabled ? "checked" : ""} onchange="toggleSectionVisibility(${idx})" class="sr-only peer">
                <div class="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
              <span class="text-xs font-semibold ${sec.enabled ? "text-white" : "text-slate-500 line-through"}">
                ${escapeHTML(getSectionDefaultLabel(sec.id))}
              </span>
            </div>

            <div class="flex items-center gap-1">
              <button onclick="moveSection(${idx}, -1)" ${idx === 0 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Chuyển lên">
                <i data-lucide="chevron-up" class="w-4 h-4"></i>
              </button>
              <button onclick="moveSection(${idx}, 1)" ${idx === resumeData.sections.length - 1 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Chuyển xuống">
                <i data-lucide="chevron-down" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Tên Tiêu đề hiển thị trên CV:</label>
            <input type="text" value="${escapeHTML(sec.title)}" oninput="updateSectionTitle(${idx}, this.value)" class="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-emerald-500 font-medium">
          </div>
        </div>
      `).join("");

      if (window.lucide) lucide.createIcons();
    }

    function getSectionDefaultLabel(id) {
      const map = {
        summary: "Mục Tóm Tắt (Summary)",
        skills: "Mục Công Nghệ & Kinh Nghiệm Sử Dụng",
        experience: "Mục Kinh Nghiệm (Experience)",
        projects: "Mục Dự Án (Projects)",
        education: "Mục Học Vấn & Chứng Chỉ (Education & Certs)"
      };
      return map[id] || id;
    }

    function updateSectionTitle(idx, val) {
      resumeData.sections[idx].title = val;
      markChanged();
    }

    function toggleSectionVisibility(idx) {
      resumeData.sections[idx].enabled = !resumeData.sections[idx].enabled;
      renderSectionTitlesConfig();
      markChanged({ render: "now" });
    }

    function moveSection(idx, direction) {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= resumeData.sections.length) return;
      const temp = resumeData.sections[idx];
      resumeData.sections[idx] = resumeData.sections[targetIdx];
      resumeData.sections[targetIdx] = temp;
      renderSectionTitlesConfig();
      markChanged({ render: "now" });
    }

    function resetSectionTitles() {
      resumeData.sections = deepClone(DEFAULT_SECTIONS);
      renderSectionTitlesConfig();
      markChanged({ render: "now" });
      showToast("Đã khôi phục tiêu đề mặc định!");
    }

    /* ----------------------------------------------------
       PROFILE
    ---------------------------------------------------- */
    function loadProfileInputs() {
      const p = resumeData.profile;
      const fields = [
        ["cfg-fullName", "fullName"],
        ["cfg-title", "title"],
        ["cfg-email", "email"],
        ["cfg-phone", "phone"],
        ["cfg-github", "github"],
        ["cfg-linkedin", "linkedin"],
        ["cfg-portfolio", "portfolio"],
        ["cfg-location", "location"],
        ["cfg-summary", "summary"],
        ["cfg-eduDegree", "eduDegree"],
        ["cfg-eduSchool", "eduSchool"],
        ["cfg-eduTime", "eduTime"],
        ["cfg-eduGpa", "eduGpa"],
        ["cfg-certifications", "certifications"]
      ];

      fields.forEach(([id, key]) => {
        const el = $(`#${id}`);
        if (el) el.value = p[key] || "";
      });
    }

    function updateProfileField(field, value) {
      resumeData.profile[field] = value;
      markChanged();
    }

    /* ----------------------------------------------------
       TECHNOLOGY & USAGE EXPERIENCE (replaces skills checklist)
    ---------------------------------------------------- */
    function renderSkillsConfig() {
      const container = $("#skills-container");
      if (!container) return;

      container.innerHTML = resumeData.skills.map((group, groupIdx) => `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-xs text-emerald-400 flex items-center gap-1.5 uppercase tracking-wide">
              <i data-lucide="cpu" class="w-3.5 h-3.5"></i> ${escapeHTML(group.categoryName)}
            </span>
            <div class="flex items-center gap-1.5">
              <button onclick="moveSkillGroup(${groupIdx}, -1)" ${groupIdx === 0 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Lên"><i data-lucide="chevron-up" class="w-3.5 h-3.5"></i></button>
              <button onclick="moveSkillGroup(${groupIdx}, 1)" ${groupIdx === resumeData.skills.length - 1 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Xuống"><i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>
            </div>
          </div>

          <div class="space-y-2.5">
            ${group.skills.map((skill, skillIdx) => `
              <div class="bg-slate-950/70 border ${skill.enabled ? "border-slate-700/80" : "border-slate-800 opacity-60"} rounded-lg p-2.5 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <label class="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" ${skill.enabled ? "checked" : ""} onchange="toggleSkill(${groupIdx}, ${skillIdx})" class="sr-only peer">
                      <div class="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                    <input type="text" value="${escapeHTML(skill.name)}" oninput="updateSkillField(${groupIdx}, ${skillIdx}, 'name', this.value)" placeholder="Công nghệ (VD: Python, FastAPI)" class="flex-1 min-w-0 bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-500 font-medium">
                  </div>
                  <div class="flex items-center gap-0.5 shrink-0">
                    <button onclick="moveSkillItem(${groupIdx}, ${skillIdx}, -1)" ${skillIdx === 0 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Lên"><i data-lucide="chevron-up" class="w-3.5 h-3.5"></i></button>
                    <button onclick="moveSkillItem(${groupIdx}, ${skillIdx}, 1)" ${skillIdx === group.skills.length - 1 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Xuống"><i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>
                    <button onclick="removeSkillItem(${groupIdx}, ${skillIdx})" class="text-slate-500 hover:text-red-400 p-1" title="Xóa"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                  </div>
                </div>
                <textarea rows="2" oninput="updateSkillField(${groupIdx}, ${skillIdx}, 'description', this.value)" placeholder="Mô tả kinh nghiệm sử dụng (VD: Xử lý tác vụ AI, phân tích dữ liệu lớn; xây dựng API/web nhanh với FastAPI...)" class="w-full bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500 resize-none">${escapeHTML(skill.description || "")}</textarea>
              </div>
            `).join("")}
          </div>

          <button onclick="addSkillToGroup(${groupIdx})" class="w-full py-1.5 text-xs rounded-lg border border-dashed border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition flex items-center justify-center gap-1.5">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> Thêm công nghệ
          </button>
        </div>
      `).join("");

      if (window.lucide) lucide.createIcons();
    }

    function toggleSkill(groupIdx, skillIdx) {
      resumeData.skills[groupIdx].skills[skillIdx].enabled = !resumeData.skills[groupIdx].skills[skillIdx].enabled;
      renderSkillsConfig();
      markChanged({ render: "now" });
    }

    function updateSkillField(groupIdx, skillIdx, field, value) {
      resumeData.skills[groupIdx].skills[skillIdx][field] = value;
      markChanged();
    }

    function addSkillToGroup(groupIdx) {
      resumeData.skills[groupIdx].skills.push({ name: "", description: "", enabled: true });
      renderSkillsConfig();
      markChanged({ render: "now" });
    }

    function removeSkillItem(groupIdx, skillIdx) {
      resumeData.skills[groupIdx].skills.splice(skillIdx, 1);
      renderSkillsConfig();
      markChanged({ render: "now" });
    }

    function moveSkillItem(groupIdx, skillIdx, direction) {
      const list = resumeData.skills[groupIdx].skills;
      const targetIdx = skillIdx + direction;
      if (targetIdx < 0 || targetIdx >= list.length) return;
      const temp = list[skillIdx];
      list[skillIdx] = list[targetIdx];
      list[targetIdx] = temp;
      renderSkillsConfig();
      markChanged({ render: "now" });
    }

    function moveSkillGroup(idx, direction) {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= resumeData.skills.length) return;
      const temp = resumeData.skills[idx];
      resumeData.skills[idx] = resumeData.skills[targetIdx];
      resumeData.skills[targetIdx] = temp;
      renderSkillsConfig();
      markChanged({ render: "now" });
    }

    function toggleAllSkillsInGroup(groupIdx, state) {
      resumeData.skills[groupIdx].skills.forEach(skill => { skill.enabled = state; });
      renderSkillsConfig();
      markChanged({ render: "now" });
    }

    function addSkillCategoryModal() {
      $("#skill-modal").classList.remove("hidden");
    }

    function closeSkillModal() {
      $("#skill-modal").classList.add("hidden");
    }

    function saveNewSkillCategory() {
      const name = $("#modal-skill-category").value.trim();
      const itemsStr = $("#modal-skill-items").value.trim();
      if (!name) return;

      const skillsList = itemsStr.split(",")
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => ({ name: item, description: "", enabled: true }));

      resumeData.skills.push({
        id: `cat-${Date.now()}`,
        categoryName: name,
        skills: skillsList
      });

      $("#modal-skill-category").value = "";
      $("#modal-skill-items").value = "";
      closeSkillModal();
      renderSkillsConfig();
      markChanged({ render: "now" });
      showToast(`Đã thêm nhóm công nghệ ${name}`);
    }

    /* ----------------------------------------------------
       PROJECTS
    ---------------------------------------------------- */
    function renderProjectsConfig() {
      const container = $("#projects-container");
      if (!container) return;

      container.innerHTML = resumeData.projects.map((proj, idx) => `
        <div class="bg-slate-900 border ${proj.enabled ? "border-slate-700/80" : "border-slate-800 opacity-60"} rounded-xl p-3.5 space-y-3 transition">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" ${proj.enabled ? "checked" : ""} onchange="toggleProject(${idx})" class="sr-only peer">
                <div class="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
              <span class="text-xs font-semibold ${proj.enabled ? "text-white" : "text-slate-400 line-through"}">
                ${escapeHTML(proj.name || "Dự án không tên")}
              </span>
            </div>
            <div class="flex items-center gap-0.5">
              <button onclick="moveProject(${idx}, -1)" ${idx === 0 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Lên"><i data-lucide="chevron-up" class="w-3.5 h-3.5"></i></button>
              <button onclick="moveProject(${idx}, 1)" ${idx === resumeData.projects.length - 1 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Xuống"><i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>
              <button onclick="removeProject(${idx})" class="text-slate-500 hover:text-red-400 p-1" title="Xóa dự án">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>

          <div class="space-y-2 text-xs">
            <div class="grid grid-cols-1 gap-3">
              <input type="text" value="${escapeHTML(proj.name)}" oninput="updateProjectField(${idx}, 'name', this.value)" placeholder="Tên dự án..." class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
              <input type="text" value="${escapeHTML(proj.role)}" oninput="updateProjectField(${idx}, 'role', this.value)" placeholder="Vai trò (Lead, Backend...)" class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
            </div>

            <div class="grid grid-cols-2 gap-3">
              <input type="text" value="${escapeHTML(proj.time || "")}" oninput="updateProjectField(${idx}, 'time', this.value)" placeholder="Thời gian (VD: 01/2025 - 06/2025)" class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
              <select onchange="updateProjectField(${idx}, 'teamType', this.value)" class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
                <option value="Individual Project" ${proj.teamType === "Individual Project" ? "selected" : ""}>Cá nhân (Individual)</option>
                <option value="Team Project" ${proj.teamType === "Team Project" ? "selected" : ""}>Nhóm (Team)</option>
              </select>
            </div>

            <div class="grid grid-cols-1 gap-3">
              <input type="text" value="${escapeHTML(proj.technologies.join(", "))}" oninput="updateProjectTechs(${idx}, this.value)" placeholder="Công nghệ (React, Go, Docker...)" class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
              <input type="text" value="${escapeHTML(proj.link)}" oninput="updateProjectField(${idx}, 'link', this.value)" placeholder="Link demo/github..." class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
            </div>

            <div>
              <label class="block text-[11px] text-slate-400 mb-1">Mô tả đóng góp (Mỗi dòng một gạch đầu dòng):</label>
              <textarea rows="2" oninput="updateProjectBullets(${idx}, this.value)" class="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500 resize-none">${escapeHTML(proj.bullets.join("\n"))}</textarea>
            </div>
          </div>
        </div>
      `).join("");

      if (window.lucide) lucide.createIcons();
    }

    function toggleProject(idx) {
      resumeData.projects[idx].enabled = !resumeData.projects[idx].enabled;
      renderProjectsConfig();
      markChanged({ render: "now" });
    }

    function updateProjectField(idx, field, value) {
      resumeData.projects[idx][field] = value;
      markChanged();
    }

    function updateProjectTechs(idx, value) {
      resumeData.projects[idx].technologies = value.split(",").map(t => t.trim()).filter(Boolean);
      markChanged();
    }

    function updateProjectBullets(idx, value) {
      resumeData.projects[idx].bullets = value.split("\n").filter(line => line.trim().length > 0);
      markChanged();
    }

    function addNewProject() {
      resumeData.projects.unshift({
        id: `proj-${Date.now()}`,
        enabled: true,
        name: "Dự án mới",
        role: "Fullstack Developer",
        time: "2024",
        teamType: "Individual Project",
        technologies: ["TypeScript", "Node.js", "Docker"],
        link: "github.com/username/project",
        bullets: [
          "Xây dựng kiến trúc module với hiệu năng cao, giảm 30% thời gian xử lý dữ liệu.",
          "Tích hợp các luồng xác thực bảo mật OAuth2 và JWT token."
        ]
      });
      renderProjectsConfig();
      markChanged({ render: "now" });
      showToast("Đã thêm dự án mới");
    }

    function removeProject(idx) {
      resumeData.projects.splice(idx, 1);
      renderProjectsConfig();
      markChanged({ render: "now" });
      showToast("Đã xóa dự án");
    }

    function moveProject(idx, direction) {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= resumeData.projects.length) return;
      const temp = resumeData.projects[idx];
      resumeData.projects[idx] = resumeData.projects[targetIdx];
      resumeData.projects[targetIdx] = temp;
      renderProjectsConfig();
      markChanged({ render: "now" });
    }

    /* ----------------------------------------------------
       EXPERIENCE
    ---------------------------------------------------- */
    function renderExperienceConfig() {
      const container = $("#experience-container");
      if (!container) return;

      container.innerHTML = resumeData.experiences.map((exp, idx) => `
        <div class="bg-slate-900 border ${exp.enabled ? "border-slate-700/80" : "border-slate-800 opacity-60"} rounded-xl p-3.5 space-y-3 transition">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" ${exp.enabled ? "checked" : ""} onchange="toggleExperience(${idx})" class="sr-only peer">
                <div class="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
              <span class="text-xs font-semibold ${exp.enabled ? "text-white" : "text-slate-400 line-through"}">
                ${escapeHTML(exp.company || "Công ty")}
              </span>
            </div>
            <div class="flex items-center gap-0.5">
              <button onclick="moveExperience(${idx}, -1)" ${idx === 0 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Lên"><i data-lucide="chevron-up" class="w-3.5 h-3.5"></i></button>
              <button onclick="moveExperience(${idx}, 1)" ${idx === resumeData.experiences.length - 1 ? 'disabled class="opacity-30 p-1"' : 'class="p-1 text-slate-400 hover:text-white"'} title="Xuống"><i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>
              <button onclick="removeExperience(${idx})" class="text-slate-500 hover:text-red-400 p-1" title="Xóa kinh nghiệm">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>

          <div class="space-y-2 text-xs">
            <div class="grid grid-cols-1 gap-3">
              <input type="text" value="${escapeHTML(exp.company)}" oninput="updateExperienceField(${idx}, 'company', this.value)" placeholder="Tên công ty..." class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
              <input type="text" value="${escapeHTML(exp.role)}" oninput="updateExperienceField(${idx}, 'role', this.value)" placeholder="Chức danh kỹ thuật..." class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
            </div>

            <div class="grid grid-cols-2 gap-3">
              <input type="text" value="${escapeHTML(exp.time)}" oninput="updateExperienceField(${idx}, 'time', this.value)" placeholder="Thời gian (01/2022 - Hiện tại)..." class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
              <input type="text" value="${escapeHTML(exp.location)}" oninput="updateExperienceField(${idx}, 'location', this.value)" placeholder="Địa điểm (TP.HCM / Remote)..." class="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500">
            </div>

            <div>
              <label class="block text-[11px] text-slate-400 mb-1">Thành tích & Trách nhiệm (Action verbs + Metrics):</label>
              <textarea rows="3" oninput="updateExperienceBullets(${idx}, this.value)" class="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500 resize-none">${escapeHTML(exp.bullets.join("\n"))}</textarea>
            </div>
          </div>
        </div>
      `).join("");

      if (window.lucide) lucide.createIcons();
    }

    function toggleExperience(idx) {
      resumeData.experiences[idx].enabled = !resumeData.experiences[idx].enabled;
      renderExperienceConfig();
      markChanged({ render: "now" });
    }

    function updateExperienceField(idx, field, value) {
      resumeData.experiences[idx][field] = value;
      markChanged();
    }

    function updateExperienceBullets(idx, value) {
      resumeData.experiences[idx].bullets = value.split("\n").filter(line => line.trim().length > 0);
      markChanged();
    }

    function addNewExperience() {
      resumeData.experiences.unshift({
        id: `exp-${Date.now()}`,
        enabled: true,
        company: "Công ty Công nghệ Mới",
        role: "Software Developer",
        time: "2023 - Hiện tại",
        location: "TP. Hồ Chí Minh",
        bullets: [
          "Phát triển các module chức năng trọng yếu, phục vụ hơn 50,000 active users hàng tháng.",
          "Phối hợp cùng Product Owner để phân tích yêu cầu kỹ thuật và chuyển đổi thành backlog stories."
        ]
      });
      renderExperienceConfig();
      markChanged({ render: "now" });
      showToast("Đã thêm kinh nghiệm");
    }

    function removeExperience(idx) {
      resumeData.experiences.splice(idx, 1);
      renderExperienceConfig();
      markChanged({ render: "now" });
      showToast("Đã xóa kinh nghiệm");
    }

    function moveExperience(idx, direction) {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= resumeData.experiences.length) return;
      const temp = resumeData.experiences[idx];
      resumeData.experiences[idx] = resumeData.experiences[targetIdx];
      resumeData.experiences[targetIdx] = temp;
      renderExperienceConfig();
      markChanged({ render: "now" });
    }

    /* ----------------------------------------------------
       STYLING & LAYOUT
    ---------------------------------------------------- */
    function setAccentColor(color) {
      resumeData.styling.accentColor = color;
      const customColor = $("#cfg-customColor");
      if (customColor) customColor.value = color;
      markChanged({ render: "now" });
    }

    function setFontFamily(fontClass) {
      resumeData.styling.fontFamily = fontClass;
      syncStyleControls();
      markChanged({ render: "now" });
    }

    function setDensity(level, evt) {
      resumeData.styling.density = level;
      syncStyleControls();
      markChanged({ render: "now" });
    }

    function toggleSeparators(checked) {
      resumeData.styling.showSeparators = checked;
      markChanged({ render: "now" });
    }

    function togglePillTags(checked) {
      resumeData.styling.pillTags = checked;
      markChanged({ render: "now" });
    }

    function togglePageNumbers(checked) {
      resumeData.styling.showPageNumbers = checked;
      markChanged({ render: "now" });
    }

    function syncStyleControls() {
      const styling = resumeData.styling;

      const colorInput = $("#cfg-customColor");
      if (colorInput) colorInput.value = styling.accentColor;

      $$(".font-opt-btn").forEach(btn => {
        btn.classList.remove("border-emerald-500", "bg-emerald-950/30");
      });
      const activeFont = $(`#font-opt-${styling.fontFamily.replace("font-", "")}`);
      if (activeFont) activeFont.classList.add("border-emerald-500", "bg-emerald-950/30");

      $$(".density-btn").forEach(btn => {
        btn.classList.remove("border-emerald-500", "bg-emerald-950/40", "text-emerald-300");
        btn.classList.add("border-slate-700", "bg-slate-900");
      });
      const activeDensity = $(`.density-btn[data-density="${styling.density}"]`);
      if (activeDensity) {
        activeDensity.classList.add("border-emerald-500", "bg-emerald-950/40", "text-emerald-300");
        activeDensity.classList.remove("border-slate-700", "bg-slate-900");
      }

      const densityLabel = $("#density-label");
      if (densityLabel) {
        densityLabel.innerText = styling.density === "compact"
          ? "Rất gọn (Fit 1 page)"
          : styling.density === "relaxed"
            ? "Thoáng"
            : "Tiêu chuẩn";
      }

      const showSeparators = $("#cfg-showSeparators");
      if (showSeparators) showSeparators.checked = styling.showSeparators;
      const pillTags = $("#cfg-pillTags");
      if (pillTags) pillTags.checked = styling.pillTags;
      const showPageNumbers = $("#cfg-showPageNumbers");
      if (showPageNumbers) showPageNumbers.checked = styling.showPageNumbers;
    }

    /* ============================================================
       A4 CHUNK RENDERING
       Mỗi section được chia thành các "chunk" nhỏ. Chunk được đo chiều
       cao thực tế (đã gồm padding-bottom) rồi xếp vào từng trang A4.
       ============================================================ */

    function chunk(html, section, kind, group, gap, keepWithNext = false) {
      return {
        html,
        sectionId: section ? section.id : null,
        sectionTitle: section ? section.title : "",
        kind,
        group,
        gap,
        keepWithNext,
        h: 0
      };
    }

    function buildChunks(density) {
      const chunks = [];

      chunks.push(chunk(buildHeaderHTML(), null, "header", "cv-header", density.gap));

      resumeData.sections.forEach(sec => {
        if (!sec.enabled) return;

        if (sec.id === "summary") {
          chunks.push(...buildSummaryChunks(sec, density));
        } else if (sec.id === "skills") {
          chunks.push(...buildSkillsChunks(sec, density));
        } else if (sec.id === "experience") {
          chunks.push(...buildExperienceChunks(sec, density));
        } else if (sec.id === "projects") {
          chunks.push(...buildProjectsChunks(sec, density));
        } else if (sec.id === "education") {
          chunks.push(...buildEducationChunks(sec, density));
        }
      });

      return chunks;
    }

    function sectionHeadingHTML(sec, continued = false, rightHTML = "") {
      const accent = resumeData.styling.accentColor;
      return `
        <h2 class="section-title text-xs font-bold uppercase tracking-wider flex items-center justify-between" style="color: ${accent};">
          <span class="flex items-center gap-1.5">
            <i data-lucide="${sec.icon || "terminal"}" class="w-3.5 h-3.5 shrink-0"></i>
            <span>${escapeHTML(sec.title)}${continued ? ' <span class="font-normal normal-case tracking-normal text-[10px] text-gray-400">(tiếp theo)</span>' : ""}</span>
          </span>
          ${rightHTML}
        </h2>
      `;
    }

    function buildHeaderHTML() {
      const p = resumeData.profile;
      const accent = resumeData.styling.accentColor;
      const iconClass = "w-3.5 h-3.5 text-gray-500 shrink-0 block";
      const brandIcon = (type) => {
        if (type === "github") {
          return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${iconClass}" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>`;
        }
        if (type === "linkedin") {
          return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${iconClass}" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg>`;
        }
        return "";
      };

      return `
        <header class="border-b pb-3 resume-block" style="border-color: #e5e7eb;">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
                ${escapeHTML(p.fullName || "FULL NAME")}
              </h1>
              <p class="text-base font-semibold tracking-wide mt-0.5" style="color: ${accent};">
                ${escapeHTML((p.title || "SOFTWARE ENGINEER").toUpperCase())}
              </p>
            </div>

            <div class="text-xs text-gray-500 text-left sm:text-right space-y-1 font-mono">
              <div class="flex items-center sm:justify-end gap-1.5">
                <i data-lucide="map-pin" class="w-3.5 h-3.5 text-gray-400 shrink-0"></i>
                <span class="leading-none">${escapeHTML(p.location || "Vietnam")}</span>
              </div>
              <div class="flex items-center sm:justify-end gap-2 text-[11px]">
                <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                <span class="text-gray-600 font-medium leading-none">Open to work</span>
              </div>
            </div>
          </div>

          <div class="mt-2.5 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600 font-mono">
            ${p.email ? `
              <a href="mailto:${escapeHTML(p.email)}" class="hover:underline flex items-center gap-1.5">
                <i data-lucide="mail" class="w-3.5 h-3.5 text-gray-500 shrink-0"></i>
                <span class="leading-none">${escapeHTML(p.email)}</span>
              </a>
            ` : ""}
            ${p.phone ? `
              <a href="tel:${escapeHTML(p.phone)}" class="hover:underline flex items-center gap-1.5">
                <i data-lucide="phone" class="w-3.5 h-3.5 text-gray-500 shrink-0"></i>
                <span class="leading-none">${escapeHTML(p.phone)}</span>
              </a>
            ` : ""}
            ${p.github ? `
              <a href="${escapeHTML(p.github.startsWith("http") ? p.github : "https://" + p.github)}" target="_blank" class="hover:underline flex items-center gap-1.5">
                ${brandIcon("github")}
                <span class="leading-none">${escapeHTML(p.github)}</span>
              </a>
            ` : ""}
            ${p.linkedin ? `
              <a href="${escapeHTML(p.linkedin.startsWith("http") ? p.linkedin : "https://" + p.linkedin)}" target="_blank" class="hover:underline flex items-center gap-1.5">
                ${brandIcon("linkedin")}
                <span class="leading-none">${escapeHTML(p.linkedin)}</span>
              </a>
            ` : ""}
            ${p.portfolio ? `
              <a href="${escapeHTML(p.portfolio.startsWith("http") ? p.portfolio : "https://" + p.portfolio)}" target="_blank" class="hover:underline flex items-center gap-1.5">
                <i data-lucide="globe" class="w-3.5 h-3.5 text-gray-500 shrink-0"></i>
                <span class="leading-none">${escapeHTML(p.portfolio)}</span>
              </a>
            ` : ""}
          </div>
        </header>
      `;
    }

    function buildSummaryChunks(sec, density) {
      const summary = (resumeData.profile.summary || "").trim();
      if (!summary) return [];

      return [
        chunk(sectionHeadingHTML(sec), sec, "heading", `heading-${sec.id}`, density.heading, true),
        chunk(
          `<p class="text-xs text-gray-700 leading-relaxed text-justify">${escapeHTML(summary)}</p>`,
          sec,
          "content",
          `summary-${sec.id}`,
          density.gap
        )
      ];
    }

    function buildSkillsChunks(sec, density) {
      const activeGroups = resumeData.skills
        .map(group => ({
          ...group,
          activeSkills: group.skills.filter(skill => skill.enabled)
        }))
        .filter(group => group.activeSkills.length > 0);

      if (!activeGroups.length) return [];

      const chunks = [
        chunk(
          sectionHeadingHTML(sec),
          sec,
          "heading",
          `heading-${sec.id}`,
          density.heading,
          true
        )
      ];

      activeGroups.forEach((group, idx) => {
        const isLastGroup = idx === activeGroups.length - 1;
        chunks.push(chunk(
          `<div class="text-[11.5px] font-bold text-gray-800">${escapeHTML(group.categoryName)}</div>`,
          sec,
          "item",
          `skill-group-${group.id || idx}-title`,
          density.bullet
        ));

        group.activeSkills.forEach((skill, sIdx) => {
          const isLast = isLastGroup && sIdx === group.activeSkills.length - 1;
          chunks.push(chunk(
            buildSkillRowHTML(skill),
            sec,
            "item",
            `skill-item-${group.id || idx}-${sIdx}`,
            isLast ? density.gap : density.bullet
          ));
        });
      });

      return chunks;
    }

    function buildSkillRowHTML(skill) {
      const name = escapeHTML(skill.name || "");
      const desc = escapeHTML(skill.description || "");
      return `
        <div class="flex gap-1.5 text-xs text-gray-700 leading-relaxed">
          <span class="text-gray-400 shrink-0">•</span>
          <span>
            ${name ? `<span class="font-semibold text-gray-800">${name}</span>` : ""}
            ${name && desc ? `<span class="text-gray-500">: </span>` : ""}
            ${desc ? `<span>${desc}</span>` : ""}
          </span>
        </div>
      `;
    }

    function buildExperienceChunks(sec, density) {
      const activeExperiences = resumeData.experiences.filter(exp => exp.enabled);
      if (!activeExperiences.length) return [];

      const chunks = [
        chunk(sectionHeadingHTML(sec), sec, "heading", `heading-${sec.id}`, density.heading, true)
      ];

      activeExperiences.forEach((exp, expIdx) => {
        const group = `exp-${exp.id || expIdx}`;
        const bullets = exp.bullets.filter(bullet => String(bullet).trim().length > 0);

        chunks.push(chunk(
          buildExperienceHeaderHTML(exp),
          sec,
          "item",
          group,
          bullets.length ? density.inner : density.gap,
          true
        ));

        bullets.forEach((bullet, bulletIdx) => {
          const isLast = bulletIdx === bullets.length - 1;
          chunks.push(chunk(
            buildBulletHTML(bullet),
            sec,
            "bullet",
            group,
            isLast ? density.gap : density.bullet
          ));
        });
      });

      return chunks;
    }

    function buildExperienceHeaderHTML(exp) {
      return `
        <div class="flex justify-between items-baseline">
          <div class="flex items-center gap-2">
            <span class="font-bold text-xs text-gray-900">${escapeHTML(exp.role)}</span>
            <span class="text-gray-400 font-normal">|</span>
            <span class="font-semibold text-xs text-gray-800">${escapeHTML(exp.company)}</span>
          </div>
          <span class="text-[11px] font-mono text-gray-500">${escapeHTML(exp.time)}</span>
        </div>
      `;
    }

    function buildProjectsChunks(sec, density) {
      const activeProjects = resumeData.projects.filter(proj => proj.enabled);
      if (!activeProjects.length) return [];

      const chunks = [
        chunk(sectionHeadingHTML(sec), sec, "heading", `heading-${sec.id}`, density.heading, true)
      ];

      activeProjects.forEach((proj, projIdx) => {
        const group = `proj-${proj.id || projIdx}`;
        const bullets = proj.bullets.filter(bullet => String(bullet).trim().length > 0);
        const isLastProject = projIdx === activeProjects.length - 1;

        chunks.push(chunk(
          buildProjectHeaderHTML(proj),
          sec,
          "item",
          group,
          density.inner
        ));

        if (proj.technologies.length) {
          chunks.push(chunk(
            buildProjectTechHTML(proj),
            sec,
            "item",
            group,
            bullets.length ? density.inner : density.gap
          ));
        }

        bullets.forEach((bullet, bulletIdx) => {
          const isLastBullet = bulletIdx === bullets.length - 1;
          const showSeparator = isLastBullet && resumeData.styling.showSeparators && !isLastProject;
          chunks.push(chunk(
            buildBulletHTML(bullet, showSeparator ? "pb-2 border-b border-gray-100" : ""),
            sec,
            "bullet",
            group,
            isLastBullet ? density.gap : density.bullet
          ));
        });
      });

      return chunks;
    }

    function buildProjectHeaderHTML(proj) {
      const teamLabel = proj.teamType === "Team Project" ? "Team" : "Individual";
      const metaParts = [proj.time, teamLabel].filter(Boolean);
      return `
        <div class="flex justify-between items-baseline gap-2">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-bold text-xs text-gray-900">${escapeHTML(proj.name)}</span>
              ${proj.role ? `<span class="text-[11px] text-gray-500 font-medium font-mono">(${escapeHTML(proj.role)})</span>` : ""}
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">${escapeHTML(teamLabel)}</span>
            </div>
            ${proj.link ? `
              <div class="mt-0.5">
                <a href="${escapeHTML(proj.link.startsWith("http") ? proj.link : "https://" + proj.link)}" target="_blank" class="text-[11px] text-emerald-700 hover:underline inline-flex items-center gap-1 font-mono break-all leading-none">
                  <i data-lucide="external-link" class="w-2.5 h-2.5 shrink-0"></i> <span>${escapeHTML(proj.link)}</span>
                </a>
              </div>
            ` : ""}
          </div>
          <span class="text-[11px] font-mono text-gray-500 shrink-0">${escapeHTML(proj.time || "")}</span>
        </div>
      `;
    }

    function buildProjectTechHTML(proj) {
      return `
        <div class="flex flex-wrap gap-1 py-0.5">
          ${proj.technologies.map(tech => `
            <span class="text-[10px] font-mono bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded">
              ${escapeHTML(tech)}
            </span>
          `).join('<span class="sr-only">, </span>')}
        </div>
      `;
    }

    function buildBulletHTML(text, extraClass = "") {
      return `
        <div class="flex gap-1.5 text-xs text-gray-700 leading-relaxed ${extraClass}">
          <span class="text-gray-400 shrink-0">•</span>
          <span>${escapeHTML(text)}</span>
        </div>
      `;
    }

    function buildEducationChunks(sec, density) {
      const p = resumeData.profile;
      const certs = (p.certifications || "").split("\n").filter(cert => cert.trim().length > 0);

      const educationBlock = `
        <div class="space-y-0.5">
          <div class="flex justify-between items-baseline text-xs font-semibold text-gray-900 gap-2">
            <span>${escapeHTML(p.eduDegree || "")}</span>
            <span class="text-[11px] font-mono text-gray-500 font-normal shrink-0">${escapeHTML(p.eduTime || "")}</span>
          </div>
          <div class="flex justify-between items-center text-xs text-gray-600 gap-2">
            <span>${escapeHTML(p.eduSchool || "")}</span>
            ${p.eduGpa ? `<span class="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-1 rounded shrink-0">${escapeHTML(p.eduGpa)}</span>` : ""}
          </div>
        </div>
      `;

      const certsBlock = certs.length ? `
        <div class="mt-2">
          <div class="text-[11px] font-semibold text-gray-700 mb-1">Competitions &amp; Certifications</div>
          <ul class="text-xs text-gray-700 space-y-1 list-disc list-inside">
            ${certs.map(cert => `<li>${escapeHTML(cert)}</li>`).join("")}
          </ul>
        </div>
      ` : "";

      return [
        chunk(sectionHeadingHTML(sec), sec, "heading", `heading-${sec.id}`, density.heading, true),
        chunk(
          `<div>${educationBlock}${certsBlock}</div>`,
          sec,
          "content",
          `education-${sec.id}`,
          density.gap
        )
      ];
    }

    /* ----------------------------------------------------
       PAGINATION ENGINE
    ---------------------------------------------------- */
    function renderMultiPageResume() {
      const styling = resumeData.styling;
      const density = DENSITY[styling.density] || DENSITY.normal;
      const fontClass = styling.fontFamily || "font-sans";
      const measureBox = $("#measure-container");

      if (!measureBox) return;

      /* 1. Tạo trang đo ẩn với đúng kích thước A4 và đúng padding/footer */
      measureBox.className = `fixed -left-[9999px] top-0 opacity-0 pointer-events-none ${fontClass} text-gray-900`;
      measureBox.innerHTML = `
        <div class="a4-page ${density.pad} ${fontClass}">
          <div id="measure-flow" class="a4-page-content"></div>
          <div class="h-6 flex items-center justify-between text-[10px] font-mono text-gray-400 border-t border-gray-100 pt-1 mt-auto">
            <span>measure</span><span>1 / 1</span>
          </div>
        </div>
      `;

      const measureFlow = $("#measure-flow");
      if (!measureFlow) return;

      /* 2. Xây dựng toàn bộ chunk theo thứ tự section */
      const chunks = buildChunks(density);

      /* 3. Đo chiều cao thật của từng chunk (đã gồm khoảng cách dưới) */
      const nodes = chunks.map(item => {
        const el = document.createElement("div");
        el.className = "cv-chunk";
        el.style.paddingBottom = `${item.gap}px`;
        el.innerHTML = item.html;
        measureFlow.appendChild(el);
        return el;
      });

      if (window.lucide) lucide.createIcons();
      chunks.forEach((item, idx) => {
        item.h = nodes[idx].getBoundingClientRect().height;
      });

      const maxContentHeight = measureFlow.clientHeight;

      /* 4. Tạo tiêu đề "(tiếp theo)" cho các section bị ngắt trang */
      const usedSections = new Set(chunks.map(item => item.sectionId).filter(Boolean));
      const continuationMap = {};

      resumeData.sections.forEach(sec => {
        if (!usedSections.has(sec.id)) return;
        const el = document.createElement("div");
        el.className = "cv-chunk";
        el.style.paddingBottom = `${density.heading}px`;
        el.innerHTML = sectionHeadingHTML(sec, true);
        measureFlow.appendChild(el);
        continuationMap[sec.id] = chunk(
          el.innerHTML,
          sec,
          "continued",
          `continued-${sec.id}`,
          density.heading
        );
        continuationMap[sec.id].h = el.getBoundingClientRect().height;
      });

      if (window.lucide) lucide.createIcons();

      /* 5. Chia chunk vào các trang */
      const pages = paginateChunks(chunks, continuationMap, maxContentHeight);
      const totalPages = pages.length;
      const pagesContainer = $("#pages-container");
      const footerName = `${escapeHTML(resumeData.profile.fullName || "")} &bull; ${escapeHTML(resumeData.profile.title || "")}`;

      pagesContainer.innerHTML = pages.map((page, pageIdx) => {
        const pageNumber = pageIdx + 1;
        return `
          <div class="a4-page ${density.pad} ${fontClass} transition-all">
            <div class="a4-page-content">
              ${page.chunks.map(item => `
                <div class="cv-chunk" style="padding-bottom: ${item.gap}px">${item.html}</div>
              `).join("")}
            </div>

            <div class="h-6 flex items-center justify-between text-[10px] font-mono text-gray-400 border-t border-gray-100 pt-1 mt-auto">
              <span class="truncate">${footerName}</span>
              ${styling.showPageNumbers ? `<span class="font-semibold text-gray-500">Trang ${pageNumber} / ${totalPages}</span>` : ""}
            </div>
          </div>
        `;
      }).join("");

      const badge = $("#page-count-badge");
      if (badge) {
        badge.innerText = `${totalPages} Trang A4`;
        badge.className = totalPages === 1
          ? "font-mono text-emerald-400 font-semibold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30"
          : "font-mono text-amber-400 font-semibold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30";
      }

      if (window.lucide) lucide.createIcons();
    }

    function paginateChunks(chunks, continuationMap, maxHeight) {
      const pages = [{ chunks: [], used: 0, sections: new Set() }];
      const currentPage = () => pages[pages.length - 1];
      const startNewPage = () => pages.push({ chunks: [], used: 0, sections: new Set() });

      const addChunk = item => {
        const page = currentPage();
        const isBody = item.sectionId && item.kind !== "heading" && item.kind !== "header";

        if (isBody && !page.sections.has(item.sectionId)) {
          const continuation = continuationMap[item.sectionId];
          if (continuation) {
            page.chunks.push(continuation);
            page.used += continuation.h;
          }
        }

        if (item.sectionId) page.sections.add(item.sectionId);
        page.chunks.push(item);
        page.used += item.h;
      };

      /* Chiều cao của cả nhóm kế tiếp (nếu nhóm đủ nhỏ để giữ nguyên),
         giúp tiêu đề section không bị mồ côi ở cuối trang. */
      const heightOfNextGroup = startIndex => {
        if (startIndex >= chunks.length) return 0;
        const groupId = chunks[startIndex].group;
        let endIndex = startIndex;
        while (endIndex < chunks.length && chunks[endIndex].group === groupId) endIndex += 1;
        const total = chunks.slice(startIndex, endIndex).reduce((sum, item) => sum + item.h, 0);
        return total <= maxHeight ? total : chunks[startIndex].h;
      };

      let index = 0;

      while (index < chunks.length) {
        const groupId = chunks[index].group;
        let end = index;
        while (end < chunks.length && chunks[end].group === groupId) end += 1;

        const groupChunks = chunks.slice(index, end);
        const groupHeight = groupChunks.reduce((total, item) => total + item.h, 0);
        const isAtomicGroup = groupHeight <= maxHeight;

        if (isAtomicGroup) {
          const first = groupChunks[0];
          const needsContinuation = first.sectionId
            && first.kind !== "heading"
            && first.kind !== "header"
            && !currentPage().sections.has(first.sectionId);
          const continuationHeight = needsContinuation && continuationMap[first.sectionId]
            ? continuationMap[first.sectionId].h
            : 0;
          const keepWithNextHeight = groupChunks.length === 1 && first.keepWithNext
            ? heightOfNextGroup(end)
            : 0;

          if (
            currentPage().chunks.length > 0
            && currentPage().used + groupHeight + continuationHeight + keepWithNextHeight > maxHeight
          ) {
            startNewPage();
          }

          groupChunks.forEach(addChunk);
          index = end;
          continue;
        }

        /* Nhóm quá dài: cho phép ngắt giữa các chunk (bullet, skill group...) */
        for (let i = index; i < end; i += 1) {
          const item = chunks[i];
          const next = chunks[i + 1];
          const needsContinuation = item.sectionId
            && item.kind !== "heading"
            && item.kind !== "header"
            && !currentPage().sections.has(item.sectionId);
          const continuationHeight = needsContinuation && continuationMap[item.sectionId]
            ? continuationMap[item.sectionId].h
            : 0;
          const keepWithNextHeight = item.keepWithNext && next
            ? (next.group === item.group ? next.h : heightOfNextGroup(i + 1))
            : 0;

          if (
            currentPage().chunks.length > 0
            && currentPage().used + item.h + continuationHeight + keepWithNextHeight > maxHeight
          ) {
            startNewPage();
          }

          addChunk(item);
        }

        index = end;
      }

      return pages;
    }

    /* ----------------------------------------------------
       ZOOM
    ---------------------------------------------------- */
    function setZoom(val) {
      currentZoom = Math.min(Math.max(val, 0.4), 1.6);
      const sheet = $("#resume-sheet-wrapper");
      if (sheet) sheet.style.transform = `scale(${currentZoom})`;
      const zoomText = $("#zoom-text");
      if (zoomText) zoomText.innerText = `${Math.round(currentZoom * 100)}%`;
    }

    function zoomIn() { setZoom(currentZoom + 0.1); }
    function zoomOut() { setZoom(currentZoom - 0.1); }
    function resetZoom() { setZoom(1); }

    /* ----------------------------------------------------
       IMPORT / EXPORT JSON
    ---------------------------------------------------- */
    function exportJSON() {
      const safeName = part => (part || "Dev")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "");

      const filename = `CV_${safeName(resumeData.profile.fullName)}_${safeName(resumeData.profile.title)}.json`;
      const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(resumeData, null, 2))}`;
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast("Đã xuất file JSON thành công!");
    }

    function importJSON(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed || !parsed.profile || !Array.isArray(parsed.skills)) {
            showToast("Định dạng file JSON không hợp lệ!");
            return;
          }

          resumeData = normalizeResumeData(parsed);
          refreshAllViews();
          markChanged({ render: "now" });
          showToast("Đã tải cấu hình CV thành công!");
        } catch (err) {
          showToast("Lỗi đọc file JSON!");
        }
      };
      reader.readAsText(file);
      event.target.value = "";
    }

    /* ----------------------------------------------------
       PRINT / PDF
    ---------------------------------------------------- */
    function triggerPrint() {
      renderMultiPageResume();
      window.print();
    }

    window.addEventListener("beforeprint", () => {
      renderMultiPageResume();
    });
