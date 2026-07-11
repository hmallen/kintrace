import type { Person } from '@shared/api.js';
import type { Scale } from '../timeline/layout';
import type { Orientation } from '../timeline/useVirtualWindow';

export type TimelineViewMode = 'explore' | 'story' | 'table';

function Toggle({
  label,
  pressed,
  onPress,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className="control-toggle" aria-pressed={pressed} onClick={onPress}>
      {label}
    </button>
  );
}

export function TimelineControls({
  view,
  scale,
  orientation,
  orientationLocked = false,
  people,
  personId,
  onViewChange,
  onScaleChange,
  onOrientationChange,
  onPersonChange,
}: {
  view: TimelineViewMode;
  scale: Scale;
  orientation: Orientation;
  /** Narrow viewports force vertical — hide the toggle rather than lie. */
  orientationLocked?: boolean;
  people: Person[];
  personId: number | undefined;
  onViewChange: (view: TimelineViewMode) => void;
  onScaleChange: (scale: Scale) => void;
  onOrientationChange: (orientation: Orientation) => void;
  onPersonChange: (personId: number | undefined) => void;
}) {
  return (
    <div className="timeline-controls">
      <fieldset className="control-group">
        <legend>View</legend>
        <Toggle label="Explore" pressed={view === 'explore'} onPress={() => onViewChange('explore')} />
        <Toggle label="Story" pressed={view === 'story'} onPress={() => onViewChange('story')} />
        <Toggle label="Table" pressed={view === 'table'} onPress={() => onViewChange('table')} />
      </fieldset>
      {view === 'explore' && (
        <>
          <fieldset className="control-group">
            <legend>Scale</legend>
            <Toggle
              label="Chronological"
              pressed={scale === 'chronological'}
              onPress={() => onScaleChange('chronological')}
            />
            <Toggle
              label="Sequential"
              pressed={scale === 'sequential'}
              onPress={() => onScaleChange('sequential')}
            />
          </fieldset>
          {!orientationLocked && (
          <fieldset className="control-group control-orientation">
            <legend>Orientation</legend>
            <Toggle
              label="Horizontal"
              pressed={orientation === 'horizontal'}
              onPress={() => onOrientationChange('horizontal')}
            />
            <Toggle
              label="Vertical"
              pressed={orientation === 'vertical'}
              onPress={() => onOrientationChange('vertical')}
            />
          </fieldset>
          )}
        </>
      )}
      <label className="control-person">
        Person
        <select
          value={personId ?? ''}
          onChange={(e) => onPersonChange(e.target.value === '' ? undefined : Number(e.target.value))}
        >
          <option value="">All people</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
