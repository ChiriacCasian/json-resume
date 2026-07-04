import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Group, Text, Badge, Card, SimpleGrid, Loader, Modal, Anchor,
  Stack, Button, Tooltip, ScrollArea, Indicator, TextInput,
} from '@mantine/core';

const LS_KEY = 'jobboard:lastSeen';

const STATUS = {
  ok: { color: 'teal', label: 'OK' },
  blocked: { color: 'orange', label: 'Blocked' },
  error: { color: 'red', label: 'Error' },
};

const loadSeen = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { return {}; }
};
const saveSeen = (obj) => localStorage.setItem(LS_KEY, JSON.stringify(obj));

// "new since you last opened this company": recent detections newer than lastSeen.
const newItemsSince = (company, seenAt) =>
  (company.recentItems || []).filter(it => (it.firstSeen || '') > (seenAt || ''));

const fmtDate = (iso) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// Logo derived from the company URL: Clearbit -> Google favicon -> initials.
function CompanyLogo({ url, name, size = 22 }) {
  const { host, domain } = useMemo(() => {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      return { host: h, domain: h.split('.').slice(-2).join('.') };
    } catch { return { host: '', domain: '' }; }
  }, [url]);

  const sources = useMemo(() => host ? [
    `https://logo.clearbit.com/${domain}`,
    `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
  ] : [], [host, domain]);

  const [idx, setIdx] = useState(0);

  if (!sources[idx]) {
    const initials = (name || '?').replace(/[^A-Za-z0-9 ]/g, '').trim()
      .split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    return (
      <Box w={size} h={size} style={{
        borderRadius: 4, flexShrink: 0, background: 'var(--mantine-color-gray-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Text size="9px" fw={700} c="dimmed">{initials}</Text>
      </Box>
    );
  }
  return (
    <img
      src={sources[idx]}
      onError={() => setIdx(i => i + 1)}
      width={size} height={size} alt=""
      style={{ borderRadius: 4, objectFit: 'contain', flexShrink: 0, background: '#fff' }}
    />
  );
}

function CompanyCard({ company, newCount, onClick }) {
  const status = STATUS[company.status] || STATUS.ok;
  return (
    <Indicator
      disabled={newCount === 0}
      label={`${newCount} new`}
      size={18} color="red" position="top-end" offset={6} withBorder
    >
      <Card
        withBorder radius="md" p="sm" h={110} onClick={onClick} className="jb-card"
        style={{
          cursor: 'pointer',
          borderColor: newCount > 0 ? 'var(--mantine-color-red-4)' : undefined,
          borderWidth: newCount > 0 ? 2 : 1,
        }}
      >
        <Stack gap={6} h="100%" justify="space-between">
          <Group gap={8} wrap="nowrap" align="center">
            <CompanyLogo url={company.url} name={company.name} />
            <Text size="sm" fw={700} lineClamp={2} style={{ flex: 1 }}>{company.name}</Text>
            <Tooltip label={status.label} withArrow>
              <Box w={8} h={8} style={{ borderRadius: '50%', flexShrink: 0 }}
                   bg={`var(--mantine-color-${status.color}-6)`} />
            </Tooltip>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">{company.totalOpen} open</Text>
            <Text size="9px" c="dimmed" truncate maw={110}>
              {(company.source || '').split(':')[0] || '—'}
            </Text>
          </Group>
        </Stack>
      </Card>
    </Indicator>
  );
}

export default function JobBoard() {
  const [state, setState] = useState(null);
  const [seen, setSeen] = useState(loadSeen);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/jobboard')
      .then(r => r.json())
      .then(setState)
      .catch(() => setState({ generatedAt: null, companies: [] }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/jobboard')
      .then(r => r.json())
      .then(d => { if (alive) setState(d); })
      .catch(() => { if (alive) setState({ generatedAt: null, companies: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const allCompanies = useMemo(() =>
    (state?.companies || []).map(c => ({ ...c, newCount: newItemsSince(c, seen[c.id]).length })),
    [state, seen]);

  const totalNew = useMemo(
    () => allCompanies.reduce((n, c) => n + c.newCount, 0), [allCompanies]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? allCompanies.filter(c => c.name.toLowerCase().includes(q)) : allCompanies;
    return [...list].sort((a, b) => b.newCount - a.newCount || a.name.localeCompare(b.name));
  }, [allCompanies, query]);

  const markSeen = useCallback((id) => {
    setSeen(prev => {
      const next = { ...prev, [id]: new Date().toISOString() };
      saveSeen(next);
      return next;
    });
  }, []);

  const openCompany = (company) => {
    setSelected(company);
    markSeen(company.id);
  };

  const markAllSeen = () => {
    const now = new Date().toISOString();
    const next = { ...seen };
    for (const c of allCompanies) next[c.id] = now;
    saveSeen(next);
    setSeen(next);
  };

  if (loading && !state) {
    return <Loader size="lg" pos="absolute" inset={0} m="auto" />;
  }

  return (
    <Box h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .jb-card {
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
          transition: box-shadow 130ms ease, transform 130ms ease;
        }
        .jb-card:hover {
          box-shadow: 0 5px 14px rgba(0,0,0,0.09);
          transform: translateY(-2px);
        }
      `}</style>
      <Group px="md" py="xs" justify="space-between" wrap="nowrap"
             style={{ borderBottom: '1px solid #e9ecef', flexShrink: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={700}>Job Board</Text>
          {totalNew > 0
            ? <Badge color="red" variant="filled">{totalNew} new</Badge>
            : <Badge color="gray" variant="light">up to date</Badge>}
        </Group>

        <TextInput
          flex={1} maw={340} size="xs"
          placeholder="Search companies…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          leftSection={<SearchIcon />}
        />

        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">checked {fmtDate(state?.generatedAt)}</Text>
          {totalNew > 0 && (
            <Button size="xs" variant="subtle" onClick={markAllSeen}>Mark all seen</Button>
          )}
          <Button size="xs" variant="default" onClick={load} loading={loading}>Refresh</Button>
        </Group>
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        <Box p="md">
          {allCompanies.length === 0 ? (
            <Text c="dimmed" ta="center" mt="xl">
              No companies yet. Add careers URLs to jobboard/companies.txt.
            </Text>
          ) : visible.length === 0 ? (
            <Text c="dimmed" ta="center" mt="xl">No companies match “{query}”.</Text>
          ) : (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="sm">
              {visible.map(c => (
                <CompanyCard key={c.id} company={c} newCount={c.newCount}
                             onClick={() => openCompany(c)} />
              ))}
            </SimpleGrid>
          )}
        </Box>
      </ScrollArea>

      <Modal
        opened={!!selected}
        onClose={() => setSelected(null)}
        title={selected && (
          <Group gap={8} wrap="nowrap">
            <CompanyLogo key={selected.url} url={selected.url} name={selected.name} size={20} />
            <Text fw={700}>{selected.name}</Text>
          </Group>
        )}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {selected && <CompanyDetail company={selected} />}
      </Modal>
    </Box>
  );
}

function CompanyDetail({ company }) {
  const recent = [...(company.recentItems || [])].sort(
    (a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
  const open = company.openItems || [];
  const status = STATUS[company.status] || STATUS.ok;

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color={status.color} variant="light">{status.label}</Badge>
        <Badge color="gray" variant="light">{company.totalOpen} open</Badge>
        {company.source && <Badge color="blue" variant="light">{company.source}</Badge>}
      </Group>

      <Anchor href={company.url} target="_blank" size="xs" c="dimmed" lineClamp={1}>
        {company.url}
      </Anchor>

      {company.status !== 'ok' && company.error && (
        <Text size="xs" c="red">{company.error}</Text>
      )}

      <Text fw={600} size="sm" mt="xs">
        Recently posted {recent.length > 0 && `(${recent.length})`}
      </Text>

      {recent.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing new in the last two weeks. You'll see new roles here the day after they appear.
        </Text>
      ) : (
        <Stack gap={4}>
          {recent.map(it => (
            <Group key={it.id} gap="xs" wrap="nowrap" align="baseline">
              <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                {it.firstSeen}
              </Badge>
              <Anchor href={it.url} target="_blank" size="sm" lineClamp={1}>{it.title}</Anchor>
            </Group>
          ))}
        </Stack>
      )}

      {open.length > 0 && (
        <>
          <Text fw={600} size="sm" mt="md">Currently open ({company.totalOpen})</Text>
          <Stack gap={2}>
            {open.map(it => (
              <Anchor key={it.id} href={it.url} target="_blank" size="sm" lineClamp={1}>
                {it.title}
              </Anchor>
            ))}
          </Stack>
          {company.totalOpen > open.length && (
            <Text size="xs" c="dimmed">
              …and {company.totalOpen - open.length} more — see the full list on the site.
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
