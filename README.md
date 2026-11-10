# DevResume Studio

CV builder A4 cho developer: chỉnh nội dung, phân trang tự động nhiều trang A4, in hoặc tải PDF, nhập/xuất JSON. Template CV được tải động từ FastAPI thay vì hardcode trong HTML.

## Cấu trúc

```
app/                 FastAPI backend
  config.py          Đường dẫn static/templates
  models.py          Pydantic models
  repository.py      Đọc và validate template JSON
  routes.py          API /api/*
  main.py            Khởi tạo app, mount static
static/
  index.html         Giao diện
  css/app.css        Style
  js/app.js          Logic CV builder
templates/
  *.json             Template CV hoàn chỉnh + metadata
tests/test_api.py    API tests
requirements.txt     Runtime dependencies
requirements-dev.txt Dev dependencies
```

## Chạy

```bash
uv venv .venv
uv pip install -r requirements-dev.txt
source .venv/bin/activate
uvicorn app.main:app --reload
```

Mở http://127.0.0.1:8000

## API

| Endpoint | Mô tả |
| --- | --- |
| `GET /api/health` | Kiểm tra service |
| `GET /api/templates` | Danh sách template (slug, name, description, order) |
| `GET /api/templates/{slug}` | Toàn bộ dữ liệu CV của template |
| `POST /api/templates` | Tạo preset JD mới từ dữ liệu hiện tại và lưu thành `templates/<slug>.json` |

Tạo preset qua UI: bấm **Thêm Preset JD** trên thanh công cụ (lưu CV đang chỉnh, kể cả khi chưa điền nội dung). Preset mới sẽ xuất hiện trong danh sách và được lưu ngay vào thư mục `templates/`.

## Template

Mỗi file trong `templates/` là một CV đầy đủ, có thêm metadata:

```json
{
  "slug": "fullstack",
  "name": "Fullstack Web",
  "description": "Mô tả ngắn",
  "order": 1,
  "profile": {},
  "sections": [],
  "skills": [],
  "experiences": [],
  "projects": [],
  "styling": {}
}
```

Thêm template mới: tạo file `<slug>.json` (slug khớp tên file), backend tự nhận và validate khi gọi API. Nếu JSON sai cấu trúc, API trả lỗi 500 với thông báo rõ file lỗi.

## Test

```bash
pytest
```
