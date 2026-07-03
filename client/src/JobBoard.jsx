import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Group, Text, Badge, Card, SimpleGrid, Loader, Modal, Anchor,
  Stack, Button, Tooltip, ScrollArea, Indicator,
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

function CompanyCard({ company, newCount, onClick }) {
  const status = STATUS[company.status] || STATUS.ok;
  return (
    <Indicator
      disabled={newCount === 0}
      label={`${newCount} new`}
      size={18}
      color="red"
      position="top-end"
      offset={6}
      withBorder
    >
      <Card
        withBorder
        radius="md"
        p="sm"
        h={110}
        onClick={onClick}
        style={{
          cursor: 'pointer',
          borderColor: newCount > 0 ? 'var(--mantine-color-red-4)' : undefined,
          borderWidth: newCount > 0 ? 2 : 1,
        }}
      >
        <Stack gap={6} h="100%" justify="space-between">
          <Group gap={6} wrap="nowrap" align="flex-start">
            <Tooltip label={status.label} withArrow>
              <Box
                w={8} h={8} mt={6} style={{ borderRadius: '50%', flexShrink: 0 }}
                bg={`var(--mantine-color-${status.color}-6)`}
              />
            </Tooltip>
            <Text size="sm" fw={700} lineClamp={2}>{company.name}</Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {company.totalOpen} open
            </Text>
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

  const companies = useMemo(() => {
    const list = (state?.companies || []).map(c => ({
      ...c,
      newCount: newItemsSince(c, seen[c.id]).length,
    }));
    list.sort((a, b) =>
      b.newCount - a.newCount ||
      a.name.localeCompare(b.name)
    );
    return list;
  }, [state, seen]);

  const totalNew = useMemo(
    () => companies.reduce((n, c) => n + c.newCount, 0),
    [companies]
  );

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
    const next = {};
    for (const c of companies) next[c.id] = now;
    saveSeen(next);
    setSeen(next);
  };

  if (loading && !state) {
    return <Loader size="lg" pos="absolute" inset={0} m="auto" />;
  }

  return (
    <Box h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      <Group px="md" py="xs" justify="space-between" wrap="nowrap"
             style={{ borderBottom: '1px solid #e9ecef', flexShrink: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={700}>Job Board</Text>
          {totalNew > 0
            ? <Badge color="red" variant="filled">{totalNew} new</Badge>
            : <Badge color="gray" variant="light">up to date</Badge>}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">
            checked {fmtDate(state?.generatedAt)}
          </Text>
          {totalNew > 0 && (
            <Button size="xs" variant="subtle" onClick={markAllSeen}>Mark all seen</Button>
          )}
          <Button size="xs" variant="default" onClick={load} loading={loading}>Refresh</Button>
        </Group>
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        <Box p="md">
          {companies.length === 0 ? (
            <Text c="dimmed" ta="center" mt="xl">
              No companies yet. Add careers URLs to jobboard/companies.txt.
            </Text>
          ) : (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="sm">
              {companies.map(c => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  newCount={c.newCount}
                  onClick={() => openCompany(c)}
                />
              ))}
            </SimpleGrid>
          )}
        </Box>
      </ScrollArea>

      <Modal
        opened={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
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
    (a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '')
  );
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
              <Anchor href={it.url} target="_blank" size="sm" lineClamp={1}>
                {it.title}
              </Anchor>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
