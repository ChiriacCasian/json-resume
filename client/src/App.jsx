import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Button, Group, Loader, Box, Text, ActionIcon, Grid, Card, Flex, SegmentedControl } from '@mantine/core';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import JobBoard from './JobBoard';

const RESUME_WIDTH = 1024;
const RESUME_HEIGHT = 1448;
const MIN_GRID_COLUMNS = 1;
const MAX_GRID_COLUMNS = 4;
const BORDER_COLOR = '#e9ecef';
const SELECTED_BORDER = '2px solid #228be6';

const SHARED_MONACO_OPTIONS = {
  wordWrap: 'on',
};

const stripThemePrefix = (theme) => theme?.replace('jsonresume-theme-', '') || '';
const addThemePrefix = (theme) => `jsonresume-theme-${theme}`;

const parseJSON = (content) => {
  try {
    return JSON.parse(content);
  } catch (error) {
    console.error('JSON parse error:', error);
    return null;
  }
};

const findDefaultTheme = (themesData, savedTheme) => {
  const savedThemeExists = themesData.find(t => t.name === savedTheme);
  return savedThemeExists?.name
    || themesData.find(t => t.name === 'flat')?.name
    || themesData[0]?.name;
};

const PanelHeader = ({ title, children }) => (
  <Group h={50} px="md" justify="space-between" wrap="nowrap" style={{ borderBottom: `1px solid ${BORDER_COLOR}` }} bg="white">
    <Text size="sm" fw={700} truncate>{title}</Text>
    <Group gap={5} wrap="nowrap">{children}</Group>
  </Group>
);

const EditorPanel = ({
  justSaved, saving, hasChanges, showDiff, setShowDiff,
  savedContent, jsonContent, setJsonContent, handleSave
}) => (
  <Panel defaultSize={50} minSize={25}>
    <Flex direction="column" h="100%">
      <PanelHeader title="resume.json">
        <Button size="xs" color={justSaved ? "green" : "dark"} onClick={handleSave} loading={saving}>
          {justSaved ? 'Saved' : (hasChanges ? 'Save *' : 'Save')}
        </Button>
        {hasChanges && (
          <Button size="xs" variant="default" onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? 'Edit' : 'Diff'}
          </Button>
        )}
      </PanelHeader>

      <Box flex={1} minHeight={0}>
        {showDiff ? (
          <DiffEditor
            height="100%"
            language="json"
            original={savedContent}
            modified={jsonContent}
            options={{ ...SHARED_MONACO_OPTIONS, readOnly: false, renderSideBySide: true }}
            onMount={(editor) => {
              const modified = editor.getModifiedEditor();
              modified.onDidChangeModelContent(() => setJsonContent(modified.getValue()));
            }}
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage="json"
            value={jsonContent}
            onChange={setJsonContent}
            options={{ ...SHARED_MONACO_OPTIONS, scrollbar: { vertical: 'auto', horizontal: 'hidden' } }}
          />
        )}
      </Box>
    </Flex>
  </Panel>
);

const PreviewPanel = ({
  themes, gridColumns, setGridColumns, currentTheme,
  jsonContent, cardRefs, handleCardClick, handleDownload, downloading
}) => (
  <Panel defaultSize={50} minSize={25}>
    <Flex direction="column" h="100%" bg="white">
      <PanelHeader title="Preview">
        <Group gap={5} wrap="nowrap">
          <Button
            size="xs"
            variant="light"
            onClick={handleDownload}
            loading={downloading}
            disabled={gridColumns !== 1}
            mr="sm"
            title={gridColumns !== 1 ? "Select a theme first to export" : "Click to export as PDF to CV dir"}
          >
            Export PDF
          </Button>
          <ActionIcon variant="default" size="sm" onClick={() => setGridColumns(Math.max(MIN_GRID_COLUMNS, gridColumns - 1))} disabled={gridColumns === MIN_GRID_COLUMNS}>−</ActionIcon>
          <Text size="xs" w={20} ta="center">{gridColumns}</Text>
          <ActionIcon variant="default" size="sm" onClick={() => setGridColumns(Math.min(MAX_GRID_COLUMNS, gridColumns + 1))} disabled={gridColumns === MAX_GRID_COLUMNS}>+</ActionIcon>
        </Group>
      </PanelHeader>

      <Box flex={1} p={20} style={{ overflowY: 'auto' }}>
        <Grid>
          {themes.map(theme => (
            <Grid.Col span={12 / gridColumns} key={theme.name}>
              <Card
                ref={el => cardRefs.current[theme.name] = el}
                p="xs" radius="md" withBorder
                style={{ cursor: 'pointer', border: currentTheme === theme.name && gridColumns === 1 ? SELECTED_BORDER : undefined }}
                onClick={() => handleCardClick(theme.name)}
              >
                <Text size="xs" fw={700} mb={5} ta="center">{theme.name}</Text>
                <Box pos="relative" w="100%" style={{ aspectRatio: `${RESUME_WIDTH} / ${RESUME_HEIGHT}`, overflow: 'hidden' }} bg="white">
                  <ThemeThumbnail theme={theme.name} json={jsonContent} />
                </Box>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      </Box>
    </Flex>
  </Panel>
);

function App() {
  const [view, setView] = useState('resume');
  const [themes, setThemes] = useState([]);
  const [currentTheme, setCurrentTheme] = useState('');
  const [jsonContent, setJsonContent] = useState(null);
  const [savedContent, setSavedContent] = useState(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [gridColumns, setGridColumns] = useState(2);
  const [showDiff, setShowDiff] = useState(false);
  const cardRefs = useRef({});

  const hasChanges = useMemo(() => jsonContent !== savedContent, [jsonContent, savedContent]);

  const scrollToTheme = (themeName) => {
    requestAnimationFrame(() => {
      cardRefs.current[themeName]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  useEffect(() => {
    Promise.all([
      fetch('/api/themes').then(r => r.json()),
      fetch('/api/resume').then(r => r.json())
    ]).then(([themesData, resumeData]) => {
      setThemes(themesData);
      const initialContent = JSON.stringify(resumeData, null, 2);
      setJsonContent(initialContent);
      setSavedContent(initialContent);

      const savedTheme = stripThemePrefix(resumeData.meta?.theme);
      const themeToUse = findDefaultTheme(themesData, savedTheme);

      if (themeToUse) {
        setCurrentTheme(themeToUse);
        if (themesData.find(t => t.name === savedTheme)) {
          setGridColumns(1);
          scrollToTheme(savedTheme);
        }
      }
    }).catch(error => console.error('Data load error:', error));
  }, []);

  const handleSave = useCallback(async () => {
    const parsed = parseJSON(jsonContent);
    if (!parsed) return alert('Invalid JSON');

    setSaving(true);
    try {
      parsed.meta = { ...parsed.meta, lastModified: new Date().toISOString() };

      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });

      const updated = JSON.stringify(parsed, null, 2);
      setJsonContent(updated);
      setSavedContent(updated);
      setJustSaved(true);
    } catch (error) {
      console.error('Save error:', error);
      alert('Error saving');
    } finally {
      setSaving(false);
    }
  }, [jsonContent]);

  const handleDownload = async () => {
    if (!currentTheme) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/export-pdf?theme=${currentTheme}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonContent
      });

      if (!response.ok) throw new Error('Export failed');

      const result = await response.json();

      // Update local state with the new version
      const parsed = JSON.parse(jsonContent);
      parsed.meta.version = result.version;
      const updated = JSON.stringify(parsed, null, 2);
      setJsonContent(updated);
      setSavedContent(updated);

      alert(`Export successful!\nVersion bumped to ${result.version}\nSaved to: ${result.path}`);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to export PDF');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => { if (hasChanges) setJustSaved(false); }, [hasChanges]);


  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const handleCardClick = (themeName) => {
    setCurrentTheme(themeName);
    setGridColumns(1);

    const parsed = parseJSON(jsonContent);
    if (parsed) {
      parsed.meta = { ...parsed.meta, theme: addThemePrefix(themeName) };
      setJsonContent(JSON.stringify(parsed, null, 2));
    }
    scrollToTheme(themeName);
  };

  const resumeView = !jsonContent ? (
    <Loader size="xl" pos="absolute" inset={0} m="auto" />
  ) : (
    <Box h="100%" w="100%" display="flex" style={{ overflow: 'hidden' }}>
      <PanelGroup direction="horizontal">
        <EditorPanel
          justSaved={justSaved}
          saving={saving}
          hasChanges={hasChanges}
          showDiff={showDiff}
          setShowDiff={setShowDiff}
          savedContent={savedContent}
          jsonContent={jsonContent}
          setJsonContent={setJsonContent}
          handleSave={handleSave}
        />
        <PanelResizeHandle style={{ width: 6, background: BORDER_COLOR, position: 'relative', cursor: 'col-resize' }}>
          <Box pos="absolute" top="50%" left="50%" style={{ transform: 'translate(-50%, -50%)' }} w={2} h={30} bg="#adb5bd" bdl={1} />
        </PanelResizeHandle>
        <PreviewPanel
          themes={themes}
          gridColumns={gridColumns}
          setGridColumns={setGridColumns}
          currentTheme={currentTheme}
          jsonContent={jsonContent}
          cardRefs={cardRefs}
          handleCardClick={handleCardClick}
          handleDownload={handleDownload}
          downloading={downloading}
        />
      </PanelGroup>
    </Box>
  );

  return (
    <Box h="100vh" w="100vw" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Group h={44} px="md" justify="center" wrap="nowrap" bg="white"
             style={{ borderBottom: `1px solid ${BORDER_COLOR}`, flexShrink: 0 }}>
        <SegmentedControl
          size="xs"
          value={view}
          onChange={setView}
          data={[{ label: 'Resume', value: 'resume' }, { label: 'Job Board', value: 'jobboard' }]}
        />
      </Group>
      <Box style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {view === 'jobboard' ? <JobBoard /> : resumeView}
      </Box>
    </Box>
  );
}

const ThemeThumbnail = memo(function ThemeThumbnail({ theme, json }) {
  const [html, setHtml] = useState('');
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/render?theme=${theme}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: json
        });
        const content = await res.text();
        setHtml(`${content}<style>body { margin: 0; }</style>`);
      } catch (error) {
        console.error(`Render error (${theme}):`, error);
      }
    })();
  }, [theme, json]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setScale(Math.min(width / RESUME_WIDTH, height / RESUME_HEIGHT));
        }
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <Box ref={containerRef} h="100%" w="100%" pos="relative" style={{ overflow: 'hidden' }}>
      {!html ? (
        <Loader size="xs" pos="absolute" top="50%" left="50%" style={{ transform: 'translate(-50%, -50%)' }} />
      ) : (
        <iframe
          srcDoc={html}
          title={theme}
          style={{
            width: `${RESUME_WIDTH}px`,
            height: `${RESUME_HEIGHT}px`,
            border: 'none',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none', // so we can click on the card
          }}
        />
      )}
    </Box>
  );
});

export default App;
