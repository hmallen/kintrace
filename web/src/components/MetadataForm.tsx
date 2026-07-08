import { Controller, type Control, type UseFormRegister } from 'react-hook-form';
import type { WorkspaceFormValues } from '../routes/Workspace';
import { FuzzyDateEditor } from './FuzzyDateEditor';

export interface MetadataFormProps {
  control: Control<WorkspaceFormValues>;
  register: UseFormRegister<WorkspaceFormValues>;
}

export function MetadataForm({ control, register }: MetadataFormProps) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0' }}>
      <legend style={{ fontWeight: 'bold', padding: 0 }}>Metadata</legend>
      <p>
        <label>
          Title <input {...register('title')} style={{ width: '100%' }} />
        </label>
      </p>
      <p>
        <label>
          Description{' '}
          <textarea {...register('description')} rows={3} style={{ width: '100%' }} />
        </label>
      </p>
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <FuzzyDateEditor value={field.value} onChange={field.onChange} />
        )}
      />
    </fieldset>
  );
}
