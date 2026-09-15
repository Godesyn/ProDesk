export type TagColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple';

export const PRIMARY_COLORS: { id: TagColor; hex: string }[] = [
  { id: 'red', hex: '#EF4444' },
  { id: 'yellow', hex: '#F59E0B' },
  { id: 'green', hex: '#10B981' },
  { id: 'blue', hex: '#3B82F6' },
  { id: 'purple', hex: '#8B5CF6' },
];

export const TAG_COLOR_MAP: Record<string, string> = {
  red: '#EF4444',
  yellow: '#F59E0B',
  green: '#10B981',
  blue: '#3B82F6',
  purple: '#8B5CF6',
};
