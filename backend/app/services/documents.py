from dataclasses import dataclass
from pathlib import Path

import fitz
from docx import Document
from openpyxl import load_workbook


@dataclass
class ExtractionResult:
    text: str
    page_count: int
    method: str
    requires_ocr: bool = False


def extract_document(path: Path, content_type: str) -> ExtractionResult:
    if content_type == "application/pdf":
        return _extract_pdf(path)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(path)
    if content_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return _extract_xlsx(path)
    if content_type == "text/plain":
        return ExtractionResult(path.read_text(encoding="utf-8", errors="replace"), 1, "plain_text")
    raise ValueError("Unsupported document type")


def _extract_pdf(path: Path) -> ExtractionResult:
    document = fitz.open(path)
    pages = [page.get_text("text") for page in document]
    text = "\n\n".join(page.strip() for page in pages if page.strip())
    requires_ocr = len(text.strip()) < max(40, len(document) * 15)
    return ExtractionResult(text, len(document), "pymupdf", requires_ocr)


def _extract_docx(path: Path) -> ExtractionResult:
    document = Document(path)
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            paragraphs.append(" | ".join(cell.text.strip() for cell in row.cells))
    return ExtractionResult("\n".join(paragraphs), 1, "python_docx")


def _extract_xlsx(path: Path) -> ExtractionResult:
    workbook = load_workbook(path, read_only=True, data_only=True)
    rows: list[str] = []
    for sheet in workbook.worksheets:
        rows.append(f"Sheet: {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            values = [str(value).strip() for value in row if value is not None and str(value).strip()]
            if values:
                rows.append(" | ".join(values))
    return ExtractionResult("\n".join(rows), len(workbook.sheetnames), "openpyxl")
