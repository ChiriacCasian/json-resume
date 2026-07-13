var fs = require('fs');
var Handlebars = require('handlebars');

Handlebars.registerHelper('formatDate', function(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
});

function render(resume) {
  // Split education courses into 3 columns for layout
  (resume.education || []).forEach(function(block) {
    if (Array.isArray(block.courses) && block.courses.length) {
      var cols = [[], [], []];
      block.courses.forEach(function(c, i) { cols[i % 3].push(c); });
      block.courses = cols;
    }
  });

  // Ensure highlights array exists (guards {{#if highlights.length}} in template)
  ['work', 'volunteer', 'awards', 'publications'].forEach(function(key) {
    (resume[key] || []).forEach(function(block) {
      block.highlights = block.highlights || [];
    });
  });

  return Handlebars.compile(fs.readFileSync(__dirname + '/resume.hbs', 'utf-8'))({
    css: fs.readFileSync(__dirname + '/style.css', 'utf-8'),
    resume: resume
  });
}

module.exports = { render: render };
