"use client";

/** Bookshelf — grid layout + upload button + per-book action menu (rename/delete/cover). */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Upload, Loader2, FileText, AlertCircle, MoreHorizontal, Trash2, Pencil, Image } from "lucide-react";
import { fetchBooks, uploadBook, deleteBook, updateBook } from "@/lib/api_client";
import type { BookMeta } from "@/lib/types";

export default function BookshelfPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [books, setBooks] = useState<BookMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Action menu state
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [coverTarget, setCoverTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadBooks = () => {
    setLoading(true);
    setError(null);
    fetchBooks()
      .then(setBooks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadBooks(); }, []);

  // Close menu on outside click
  useEffect(() => {
    const handler = () => setMenuOpen(null);
    if (menuOpen) document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      await uploadBook(file, (pct) => setUploadProgress(pct));
      await loadBooks();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (bookName: string) => {
    setActionLoading(true);
    try {
      await deleteBook(bookName);
      setBooks((prev) => prev.filter((b) => b.book_name !== bookName));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActionLoading(false);
      setDeleteConfirm(null);
      setMenuOpen(null);
    }
  };

  const handleRename = async (oldName: string) => {
    const newName = prompt("新名称：", oldName);
    if (!newName || newName === oldName) { setRenameTarget(null); return; }
    setActionLoading(true);
    try {
      const res = await updateBook(oldName, { new_name: newName });
      loadBooks();
      setRenameTarget(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setActionLoading(false);
      setMenuOpen(null);
    }
  };

  const handleCoverChange = async (bookName: string, file: File) => {
    setActionLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        await updateBook(bookName, { cover_url: dataUrl });
        loadBooks();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Cover change failed");
      } finally {
        setActionLoading(false);
        setCoverTarget(null);
        setMenuOpen(null);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <main className="min-h-screen bg-neutral-50">
      {/* Hidden cover input */}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && coverTarget) handleCoverChange(coverTarget, file);
          if (coverInputRef.current) coverInputRef.current.value = "";
        }}
      />

      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-neutral-700" />
            <h1 className="text-base font-semibold text-neutral-800">DeepRead</h1>
            <span className="text-xs text-neutral-400 ml-1">· 书架</span>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all ${
              uploading ? "bg-neutral-100 text-neutral-400 cursor-not-allowed" : "bg-neutral-800 text-white hover:bg-neutral-700 active:scale-95"
            }`}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? "导入中…" : "导入书籍"}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.epub,.txt,.md,.html,.tex,.docx" onChange={handleUpload} className="hidden" />
        </div>
      </header>

      {/* Upload progress */}
      {uploading && (
        <div className="max-w-5xl mx-auto px-6 mt-4">
          <div className="bg-white border border-neutral-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-neutral-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-neutral-600 mb-1">正在处理文件…</div>
              <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div className="h-full bg-neutral-700 rounded-full transition-all duration-300" style={{ width: `${Math.min(uploadProgress, 100)}%` }} />
              </div>
            </div>
            <span className="text-xs text-neutral-400 shrink-0">{uploadProgress}%</span>
          </div>
        </div>
      )}
      {uploadError && (
        <div className="max-w-5xl mx-auto px-6 mt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle size={14} /> {uploadError}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center py-16">
            <Loader2 size={24} className="animate-spin text-neutral-300 mx-auto" />
            <p className="text-sm text-neutral-400 mt-3">加载书架…</p>
          </div>
        )}
        {!loading && error && (
          <div className="text-center py-16">
            <AlertCircle size={32} className="text-red-300 mx-auto mb-3" />
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={loadBooks} className="mt-4 px-4 py-1.5 text-xs rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200">重试</button>
          </div>
        )}
        {!loading && !error && books.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 select-none">📚</div>
            <h2 className="text-lg font-medium text-neutral-500 mb-2">书架空空</h2>
            <p className="text-sm text-neutral-400 mb-6">点击顶部「导入书籍」上传 PDF / EPUB 开始阅读</p>
            <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 px-5 py-2 text-sm rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 transition-colors">
              <Upload size={14} /> 导入第一本书
            </button>
          </div>
        )}

        {/* Book grid */}
        {!loading && !error && books.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {books.map((book) => (
              <div key={book.book_name} className="group cursor-pointer relative">
                {/* Card body */}
                <div
                  onClick={() => router.push(`/read/${encodeURIComponent(book.book_name)}`)}
                  className="aspect-[3/4] rounded-lg bg-white border border-neutral-200 shadow-sm overflow-hidden group-hover:shadow-md group-hover:-translate-y-0.5 transition-all duration-200 flex flex-col items-center justify-center relative"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-2 bg-neutral-300" />

                  {(book as any).cover_url ? (
                    <img src={(book as any).cover_url} alt={book.title} className="w-full h-full object-cover" />
                  ) : (
                    <>
                      <FileText size={28} className="text-neutral-300 mb-2" />
                      <h3 className="text-xs font-medium text-neutral-700 text-center px-3 line-clamp-3 leading-snug">{book.title}</h3>
                    </>
                  )}

                  {/* Action menu trigger */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === book.book_name ? null : book.book_name); }}
                    className="absolute top-1 right-1 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-neutral-100 transition-all"
                  >
                    <MoreHorizontal size={12} className="text-neutral-400" />
                  </button>

                  {/* Dropdown menu */}
                  {menuOpen === book.book_name && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-8 right-1 bg-white border border-neutral-200 rounded-md shadow-lg z-30 py-1 min-w-[120px]"
                    >
                      <button
                        onClick={() => { setRenameTarget(book.book_name); setMenuOpen(null); setTimeout(() => handleRename(book.book_name), 0); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 flex items-center gap-2"
                      >
                        <Pencil size={12} /> 重命名
                      </button>
                      <button
                        onClick={() => { setCoverTarget(book.book_name); setMenuOpen(null); coverInputRef.current?.click(); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 flex items-center gap-2"
                      >
                        <Image size={12} /> 更换封面
                      </button>
                      <hr className="my-0.5 border-neutral-100" />
                      <button
                        onClick={() => setDeleteConfirm(book.book_name)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 text-red-600 flex items-center gap-2"
                      >
                        <Trash2 size={12} /> 删除
                      </button>
                    </div>
                  )}
                </div>

                {/* Meta */}
                <div className="mt-1.5 px-1">
                  <p className="text-[10px] text-neutral-400 truncate">
                    {book.file_type?.toUpperCase() ?? "MD"}
                    {book.chapter_count > 0 && <> · {book.chapter_count} 章</>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete confirm dialog */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
            <div className="bg-white rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
              <h3 className="text-sm font-semibold text-neutral-800 mb-2">确认删除</h3>
              <p className="text-xs text-neutral-500 mb-4">将永久删除书籍「{deleteConfirm}」及其所有章节和笔记。此操作不可撤销。</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDeleteConfirm(null)} className="px-4 py-1.5 text-xs rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200">取消</button>
                <button onClick={() => handleDelete(deleteConfirm)} disabled={actionLoading}
                  className="px-4 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  {actionLoading ? "删除中…" : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
