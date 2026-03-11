"""RAG service — ChromaDB vector store + OpenAI embeddings + section-level chunking."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import chromadb
from openai import OpenAI, AsyncOpenAI

from app.core.config import settings

# ── Clients ────────────────────────────────────────────────────────────

_openai = OpenAI(api_key=settings.OPENAI_API_KEY)
_async_openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

CHROMA_DIR = Path("storage/kb/chroma")
CHROMA_DIR.mkdir(parents=True, exist_ok=True)

_chroma = chromadb.PersistentClient(path=str(CHROMA_DIR))

COLLECTION_NAME = "knowledge_base"
_collection = _chroma.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},
)

# Only these keys can be used in ChromaDB 'where' clause
ALLOWED_FILTER_KEYS = {"doc_id", "doc_title", "section", "category", "tags", "section_index"}

KB_FILE = Path("storage/kb/seed_data.json")


# ── Embedding ──────────────────────────────────────────────────────────

def _embed(texts: list[str]) -> list[list[float]]:
    """Embed texts using OpenAI text-embedding-3-small."""
    resp = _openai.embeddings.create(
        model=settings.EMBEDDING_MODEL,
        input=texts,
    )
    return [d.embedding for d in resp.data]


def embed_text(text: str) -> list[float]:
    """Exposed method for single text embedding."""
    return _embed([text])[0]

async def _embed_async(texts: list[str]) -> list[list[float]]:
    """Embed texts asynchronously using OpenAI text-embedding-3-small."""
    resp = await _async_openai.embeddings.create(
        model=settings.EMBEDDING_MODEL,
        input=texts,
    )
    return [d.embedding for d in resp.data]

async def embed_text_async(text: str) -> list[float]:
    """Async exposed method for single text embedding."""
    res = await _embed_async([text])
    return res[0]


# ── Chunking ───────────────────────────────────────────────────────────

def _chunk_document(doc: dict) -> list[dict]:
    """Split a document into section-level chunks with metadata.

    Strategy: each section becomes one chunk. The parent document title
    and tags are prepended for context so the embedding captures both
    the topic and the specific section content.
    """
    chunks = []
    doc_id = doc["id"]
    title = doc["title"]
    category = doc.get("category", "")
    tags = doc.get("tags", [])

    for i, section in enumerate(doc.get("sections", [])):
        heading = section.get("heading", f"Section {i}")
        content = section.get("content", "")

        # Build chunk text: title + heading + content for rich embedding
        chunk_text = f"{title} — {heading}\n\n{content}"
        chunk_id = f"{doc_id}_s{i}"

        chunks.append({
            "chunk_id": chunk_id,
            "doc_id": doc_id,
            "text": chunk_text,
            "metadata": {
                "doc_id": doc_id,
                "doc_title": title,
                "section": heading,
                "category": category,
                "tags": ",".join(tags),
                "section_index": str(i),
            },
        })
    return chunks


# ── Index Management ───────────────────────────────────────────────────

def rebuild_index() -> int:
    """Re-chunk all documents from KB file and rebuild the vector index."""
    global _collection
    # Clear existing
    try:
        _chroma.delete_collection(COLLECTION_NAME)
    except Exception:
        pass
    _collection = _chroma.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    docs = _load_docs()
    if not docs:
        return 0

    all_chunks = []
    for doc in docs:
        all_chunks.extend(_chunk_document(doc))

    if not all_chunks:
        return 0

    # Embed in batches of 50
    batch_size = 50
    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i : i + batch_size]
        texts = [c["text"] for c in batch]
        embeddings = _embed(texts)
        _collection.add(
            ids=[c["chunk_id"] for c in batch],
            embeddings=embeddings,
            documents=texts,
            metadatas=[c["metadata"] for c in batch],
        )

    return len(all_chunks)


# ── Search ─────────────────────────────────────────────────────────────

def search(query: str, top_k: int = 5, filters: dict = None) -> list[dict]:
    """Semantic search over the knowledge base. Returns top-k chunks."""
    if _collection.count() == 0:
        rebuild_index()
    if _collection.count() == 0:
        return []

    where_clause = None
    if filters:
        # Only allow keys that exist in our collection metadata to prevent 0 results
        valid_filters = {
            k: v for k, v in filters.items() 
            if k in ALLOWED_FILTER_KEYS and isinstance(v, (str, int, float, bool))
        }
        if valid_filters:
            if len(valid_filters) == 1:
                where_clause = valid_filters
            else:
                where_clause = {"$and": [{k: v} for k, v in valid_filters.items()]}

    query_embedding = _embed([query])[0]
    
    kwargs = {
        "query_embeddings": [query_embedding],
        "n_results": min(top_k, _collection.count())
    }
    if where_clause:
        kwargs["where"] = where_clause

    results = _collection.query(**kwargs)

    hits = []
    for i in range(len(results["ids"][0])):
        meta = results["metadatas"][0][i] if results["metadatas"] else {}
        hits.append({
            "chunk_id": results["ids"][0][i],
            "doc_title": meta.get("doc_title", ""),
            "section": meta.get("section", ""),
            "category": meta.get("category", ""),
            "tags": meta.get("tags", "").split(",") if meta.get("tags") else [],
            "content": results["documents"][0][i] if results["documents"] else "",
            "relevance": round(1 - (results["distances"][0][i] if results["distances"] else 1), 3),
        })
    
    return hits


# ── CRUD (admin) ───────────────────────────────────────────────────────

def _load_docs() -> list[dict]:
    if KB_FILE.exists():
        return json.loads(KB_FILE.read_text(encoding="utf-8"))
    return []


def _save_docs(docs: list[dict]) -> None:
    KB_FILE.parent.mkdir(parents=True, exist_ok=True)
    KB_FILE.write_text(json.dumps(docs, indent=2, ensure_ascii=False), encoding="utf-8")


def list_documents() -> list[dict]:
    return _load_docs()


def get_document(doc_id: str) -> dict | None:
    for doc in _load_docs():
        if doc["id"] == doc_id:
            return doc
    return None


def add_document(doc: dict) -> dict:
    docs = _load_docs()
    if not doc.get("id"):
        doc["id"] = f"rb-{uuid.uuid4().hex[:6]}"
    docs.append(doc)
    _save_docs(docs)
    rebuild_index()
    return doc


def update_document(doc_id: str, updates: dict) -> dict | None:
    docs = _load_docs()
    for i, d in enumerate(docs):
        if d["id"] == doc_id:
            docs[i] = {**d, **updates, "id": doc_id}
            _save_docs(docs)
            rebuild_index()
            return docs[i]
    return None


def delete_document(doc_id: str) -> bool:
    docs = _load_docs()
    new_docs = [d for d in docs if d["id"] != doc_id]
    if len(new_docs) == len(docs):
        return False
    _save_docs(new_docs)
    rebuild_index()
    return True
