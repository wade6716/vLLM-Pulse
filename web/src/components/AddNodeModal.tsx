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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-white/15 shadow-2xl p-5"
        style={{
          background: 'rgba(28, 28, 30, 0.92)',
          backdropFilter: 'blur(32px) saturate(180%)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#F5F5F7] tracking-tight">添加临时 vLLM 监控节点</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/60 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-white/60 mb-1.5">节点别名（可选）</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：gpu-h100-canary"
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-[#F5F5F7] placeholder:text-white/25 focus:outline-none focus:border-[#0A84FF]"
            />
          </div>

          <div>
            <label className="block text-xs text-white/60 mb-1.5">Metrics 地址 *</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://10.0.1.12:11435/metrics"
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-[#F5F5F7] placeholder:text-white/25 focus:outline-none focus:border-[#0A84FF]"
            />
          </div>

          <div>
            <label className="block text-xs text-white/60 mb-1.5">Authorization 请求头（可选）</label>
            <input
              type="text"
              value={authHeader}
              onChange={(e) => setAuthHeader(e.target.value)}
              placeholder="Bearer <token>"
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-[#F5F5F7] placeholder:text-white/25 focus:outline-none focus:border-[#0A84FF]"
            />
          </div>

          {error && (
            <div className="px-3.5 py-2 rounded-xl bg-[#FF453A]/15 border border-[#FF453A]/35 text-xs text-[#FF6961]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white/70 hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              {submitting ? '连接中...' : '添加节点'}
            </button>
          </div>
        </form>

        {dynamicNodes.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-white/10">
            <div className="text-[11px] font-medium text-white/45 mb-2">已添加的临时节点</div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto noc-inner-scroll">
              {dynamicNodes.map((n) => (
                <div
                  key={n.id}
                  className="apple-subcard flex items-center justify-between px-3 py-1.5 text-xs"
                >
                  <span className="truncate text-[#F5F5F7]">{n.name}</span>
                  <button
                    type="button"
                    onClick={() => void onDelete(n.id)}
                    className="p-1 text-white/45 hover:text-[#FF453A] transition-colors cursor-pointer"
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
