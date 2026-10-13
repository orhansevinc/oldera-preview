function escapeHelp(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function escapeLabel(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelText(labels = {}, extra = {}) {
  const merged = { ...labels, ...extra };
  const entries = Object.entries(merged);
  if (!entries.length) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

export function renderPrometheus(registryOrSnapshot) {
  const snapshot = Array.isArray(registryOrSnapshot)
    ? registryOrSnapshot
    : registryOrSnapshot.snapshot();
  const lines = [];

  for (const metric of snapshot) {
    if (metric.help) lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    for (const series of metric.series) {
      if (metric.type === 'histogram') {
        for (const bucket of series.buckets) {
          lines.push(`${metric.name}_bucket${labelText(series.labels, { le: bucket.le })} ${bucket.count}`);
        }
        lines.push(`${metric.name}_bucket${labelText(series.labels, { le: '+Inf' })} ${series.count}`);
        lines.push(`${metric.name}_sum${labelText(series.labels)} ${series.sum}`);
        lines.push(`${metric.name}_count${labelText(series.labels)} ${series.count}`);
      } else {
        lines.push(`${metric.name}${labelText(series.labels)} ${series.value}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}
