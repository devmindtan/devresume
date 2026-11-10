from fastapi import APIRouter, HTTPException

from . import repository
from .models import Template, TemplateCreate, TemplateSummary

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/templates", response_model=list[TemplateSummary])
def list_templates() -> list[TemplateSummary]:
    return repository.list_templates()


@router.post("/templates", response_model=Template, status_code=201)
def create_template(payload: TemplateCreate) -> Template:
    return repository.create_template(payload)


@router.get("/templates/{slug}", response_model=Template)
def get_template(slug: str) -> Template:
    try:
        return repository.get_template(slug)
    except repository.TemplateNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Template '{slug}' not found") from exc
