const fs = require('fs');
const { ProseMetricsService } = require('./packages/projects/dist/services/prose-metrics.js');

const service = new ProseMetricsService();
const text = fs.readFileSync('./workspace/projects/project-77-calibrate/manuscript/step-1128-pass-87-introspection-sample-part-2.md', 'utf-8');

const metrics = service.analyze(text);
const report = service.evaluate(metrics);

console.log('Metrics:', JSON.stringify(metrics, null, 2));
console.log('Report Failures:', report.failures);
console.log('Instructions:', report.correctiveInstructions);
