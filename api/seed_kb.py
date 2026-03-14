import os
import json
import shutil
from pathlib import Path

# Fix relative imports
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services import rag_service
try:
    from pypdf import PdfReader
except ImportError:
    print("pypdf not installed. Please run: pip install pypdf")
    sys.exit(1)

def main():
    print("Seeding Knowledge Base...")

    KNOWLEDGE_DIR = Path("storage/knowledge")
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    
    # 1. Seed PDF
    pdf_path = Path("Sales_Playbook_2026.pdf")
    if pdf_path.exists():
        dest_path = KNOWLEDGE_DIR / pdf_path.name
        # Copy to storage
        shutil.copy(pdf_path, dest_path)
        
        # Read and add to RAG
        reader = PdfReader(str(dest_path))
        sections = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text and text.strip():
                sections.append({
                    "heading": f"Page {i + 1}",
                    "content": text.strip()
                })
        if sections:
            # Need to avoid adding duplicate
            existing_docs = rag_service.list_documents()
            title = pdf_path.name.replace(".pdf", "")
            if not any(d.get("title") == title for d in existing_docs):
                doc_data = {
                    "title": title,
                    "category": "pdf_document",
                    "tags": ["pdf", "sales", "playbook"],
                    "sections": sections
                }
                rag_service.add_document(doc_data)
                print(f"✅ Added PDF: {pdf_path.name} ({len(sections)} pages indexed)")
            else:
                print(f"✅ PDF {pdf_path.name} is already indexed in the Knowledge Base.")

    # 2. Seed JSON
    json_path = Path("Company_Discounts_Q3.json")
    if json_path.exists():
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            existing_docs = rag_service.list_documents()
            
            for doc in data:
                if not any(d.get("id") == doc.get("id") for d in existing_docs):
                    rag_service.add_document(doc)
                    print(f"✅ Added JSON Doc: {doc.get('title')}")
                else:
                    print(f"✅ JSON Doc {doc.get('title')} is already indexed.")

    print("\nKnowledge Base Seeding Complete!")

if __name__ == "__main__":
    main()
