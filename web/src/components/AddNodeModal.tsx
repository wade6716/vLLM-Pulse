import { useState, type FormEvent } from 'react';
import { Trash2, X } from 'lucide-react';
import type { NodeSummary } from '../types';

interface AddNodeModalProps {
  open: boolean;
  onClose: () => void;
  nodes: NodeSummary[];
  onAdd: (payload: { name: string; url: string; headers?: Record<string, string> }) => Promise<NodeSummary>;
  onDelete: (id: string) => Promise<void>;
}

export function AddNodeModal({ open, onClose, nodes, onAdd, onDelete }: AddNodeModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const headers: Record<string, string> = {};
      if (authHeader.trim()) {
        headers.Authorization = authHeader.trim();
      }
      await onAdd({ name: name.trim(), url: url.trim(), headers });
      setName('');
      setUrl('');
      setAuthHeader('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加节点失败');
    } finally {
      setSubmitting(false);
    }
  };

  const dynamicNodes = nodes.filter((n) => n.dynamic);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-[#111827] border border-slate-700 shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-100">添加临时 vLLM 监控节点</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">节点别名（可选）</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：gpu-h100-canary"
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F19] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Metrics 地址 *</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://10.0.1.12:11435/metrics"
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F19] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Authorization 请求头（可选）</label>
            <input
              type="text"
              value={authHeader}
              onChange={(e) => setAuthHeader(e.target.value)}
              placeholder="Bearer <token>"
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F19] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 cursor-pointer"
            >
              {submitting ? '连接中...' : '添加节点'}
            </button>
          </div>
        </form>

        {dynamicNodes.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-800">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 mb-2">
              已添加的临时节点
            </div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {dynamicNodes.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[#0B0F19] border border-slate-800 text-xs"
                >
                  <span className="truncate text-slate-200">{n.name}</span>
                  <button
                    type="button"
                    onClick={() => void onDelete(n.id)}
                    className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                    title="移除节点"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
