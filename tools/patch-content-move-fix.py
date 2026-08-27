from pathlib import Path
p = Path('app.js')
s = p.read_text(encoding='utf-8')
old = '<label class="v1-content-move-check" title="勾選後可批次移動"><input type="checkbox" data-content-move-check data-source-lesson="${escapeHtml(lesson.id)}" value="${escapeHtml(content.id)}"><span class="sr-only">選擇 ${escapeHtml(content.title)}</span></label>'
new = '<label class="v1-content-move-check" title="勾選後可批次移動"><input type="checkbox" aria-label="勾選教材 ${escapeHtml(content.title)}" data-content-move-check data-source-lesson="${escapeHtml(lesson.id)}" value="${escapeHtml(content.id)}"></label>'
assert s.count(old) == 1, f'checkbox anchor count={s.count(old)}'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('finalized content move checkbox UI')
