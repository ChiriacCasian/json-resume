
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { render, pdf } from 'resumed';

const app = express();
const PORT = 3001;
const RESUME_PATH = path.resolve('resume.json');
const JOBBOARD_STATE_PATH = path.resolve('jobboard/state.json');
const JOBBOARD_STATE_URL =
    'https://raw.githubusercontent.com/ChiriacCasian/json-resume/main/jobboard/state.json';
const EMPTY_STATE = { generatedAt: null, companies: [] };

app.use(express.json({ limit: '50mb' }));

async function getRenderedHtml(resume, themeName) {
    const pkgName = `jsonresume-theme-${themeName}`;
    const theme = await import(pkgName);

    try {
        return await render(resume, theme);
    } catch (e1) {
        if (theme.render) return await theme.render(resume);
        if (theme.default?.render) return await theme.default.render(resume);
        if (typeof theme.default === 'function') return await theme.default(resume);
        throw new Error('No render method found');
    }
}

app.get('/api/themes', async (req, res) => {
    try {
        const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8'));
        const list = Object.keys(pkg.dependencies).filter(d => d.startsWith('jsonresume-theme-'));
        res.json(list.map(d => ({ name: d.replace('jsonresume-theme-', '') })));
    } catch { res.json([]) }
});

app.get('/api/resume', async (req, res) => {
    try { res.json(JSON.parse(await fs.readFile(RESUME_PATH, 'utf-8'))); }
    catch { res.status(500).send('Error'); }
});

app.post('/api/save', async (req, res) => {
    try {
        await fs.writeFile(RESUME_PATH, JSON.stringify(req.body, null, 2));
        res.send('Saved');
    } catch { res.status(500).send('Error'); }
});

// Job-board tracker state. The daily GitHub Action commits jobboard/state.json;
// we serve whichever copy is newer — the pushed one on GitHub (no `git pull`
// needed) or a freshly-scraped local one — falling back to local when offline.
async function readLocalState() {
    try { return JSON.parse(await fs.readFile(JOBBOARD_STATE_PATH, 'utf-8')); }
    catch { return null; }
}

async function fetchRemoteState() {
    try {
        const r = await fetch(JOBBOARD_STATE_URL, { signal: AbortSignal.timeout(5000) });
        return r.ok ? await r.json() : null;
    } catch { return null; }
}

app.get('/api/jobboard', async (req, res) => {
    const candidates = (await Promise.all([readLocalState(), fetchRemoteState()]))
        .filter(Boolean)
        .sort((a, b) => (b?.generatedAt || '').localeCompare(a?.generatedAt || ''));
    res.json(candidates[0] || EMPTY_STATE);
});

app.post('/render', async (req, res) => {
    try {
        const html = await getRenderedHtml(req.body, req.query.theme);
        res.send(html);
    } catch (e) {
        console.error(`Render failed:`, e.message);
        res.status(500).send(`<h1>Render Error</h1><p>${e.message}</p>`);
    }
});

app.post('/api/export-pdf', async (req, res) => {
    try {
        const themeName = req.query.theme;
        let resume = req.body;

        // Increment the version stored in resume.json
        const nextVersion = parseInt(resume.meta?.version || '0') + 1;

        if (!resume.meta) resume.meta = {};
        resume.meta.version = nextVersion.toString();
        resume.meta.lastModified = new Date().toISOString();

        // Persist the bumped version back to resume.json
        await fs.writeFile(RESUME_PATH, JSON.stringify(resume, null, 2));

        const html = await getRenderedHtml(resume, themeName);
        const theme = await import(`jsonresume-theme-${themeName}`);
        const pdfBuffer = await pdf(html, resume, theme);

        const personSlug = (resume.basics?.name || 'Resume').trim().replace(/\s+/g, '-');
        const fileName = `${personSlug}-CV-1-page-v${nextVersion}.pdf`;

        // Stream the PDF straight back to the browser as a download.
        // (No longer written to disk outside the project directory.)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('X-Resume-Version', nextVersion.toString());
        res.setHeader('Access-Control-Expose-Headers', 'X-Resume-Version, Content-Disposition');
        res.send(Buffer.from(pdfBuffer));
    } catch (e) {
        console.error(`PDF Export failed:`, e.message);
        res.status(500).send('PDF Export failed');
    }
});

app.listen(PORT, () => console.log(`API at http://localhost:${PORT}`));
