from typing import Any

from pydantic import BaseModel, Field


class TemplateSummary(BaseModel):
    """Metadata shown in the template dropdown."""

    slug: str = Field(pattern=r"^[a-z0-9_]+$")
    name: str
    description: str = ""
    order: int = 0


class Template(TemplateSummary):
    """A complete CV document loaded from templates/<slug>.json."""

    profile: dict[str, Any]
    sections: list[dict[str, Any]]
    skills: list[dict[str, Any]]
    experiences: list[dict[str, Any]]
    projects: list[dict[str, Any]]
    styling: dict[str, Any]


class TemplateCreate(BaseModel):
    """Payload for saving the current CV as a new template file."""

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    profile: dict[str, Any] = Field(default_factory=dict)
    sections: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[dict[str, Any]] = Field(default_factory=list)
    experiences: list[dict[str, Any]] = Field(default_factory=list)
    projects: list[dict[str, Any]] = Field(default_factory=list)
    styling: dict[str, Any] = Field(default_factory=dict)
