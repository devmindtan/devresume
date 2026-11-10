import json
import re
import unicodedata
from pathlib import Path

from .config import TEMPLATES_DIR
from .models import Template, TemplateCreate, TemplateSummary

SLUG_PATTERN = re.compile(r"^[a-z0-9_]+$")


class TemplateNotFoundError(LookupError):
    pass


def _load_file(path: Path) -> Template:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Template {path.name} is not valid JSON: {exc}") from exc

    template = Template.model_validate(raw)
    if template.slug != path.stem:
        raise ValueError(f"Template {path.name} has slug '{template.slug}'")
    return template


def list_templates() -> list[TemplateSummary]:
    """Return template metadata sorted by the `order` field."""
    templates = (
        _load_file(path)
        for path in TEMPLATES_DIR.glob("*.json")
    )
    return [
        TemplateSummary.model_validate(template.model_dump())
        for template in sorted(templates, key=lambda item: (item.order, item.slug))
    ]


def get_template(slug: str) -> Template:
    if not SLUG_PATTERN.fullmatch(slug):
        raise TemplateNotFoundError(slug)

    path = TEMPLATES_DIR / f"{slug}.json"
    if not path.is_file():
        raise TemplateNotFoundError(slug)
    return _load_file(path)


def _slugify(name: str) -> str:
    text = name.replace("đ", "d").replace("Đ", "D")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug or "preset"


def _unique_slug(base: str) -> str:
    slug = base
    index = 2
    while (TEMPLATES_DIR / f"{slug}.json").exists():
        slug = f"{base}_{index}"
        index += 1
    return slug


def _write_template(path: Path, template: Template) -> None:
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(
        json.dumps(template.model_dump(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)


def create_template(payload: TemplateCreate) -> Template:
    """Persist the current CV as templates/<slug>.json and return it."""
    templates = list_templates()
    order = max((item.order for item in templates), default=0) + 1
    slug = _unique_slug(_slugify(payload.name))

    template = Template(
        slug=slug,
        name=payload.name,
        description=payload.description,
        order=order,
        profile=payload.profile,
        sections=payload.sections,
        skills=payload.skills,
        experiences=payload.experiences,
        projects=payload.projects,
        styling=payload.styling,
    )
    _write_template(TEMPLATES_DIR / f"{slug}.json", template)
    return template


def update_template(slug: str, payload: TemplateCreate) -> Template:
    """Replace the content of an existing template file."""
    existing = get_template(slug)
    template = Template(
        slug=existing.slug,
        name=payload.name or existing.name,
        description=payload.description,
        order=existing.order,
        profile=payload.profile,
        sections=payload.sections,
        skills=payload.skills,
        experiences=payload.experiences,
        projects=payload.projects,
        styling=payload.styling,
    )
    _write_template(TEMPLATES_DIR / f"{slug}.json", template)
    return template
