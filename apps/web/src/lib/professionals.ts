import type {
  ProfessionalPage,
  ProfessionalProfile,
} from '@thoughtfull/shared';

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' });
  const result = await response.json();

  if (!response.ok)
    throw new Error(
      result.message ?? 'Unable to load professionals. Please try again.',
    );

  return result as T;
}

export const getProfessionals = (page: number) =>
  request<ProfessionalPage>(`/api/professionals?page=${page}`);

export const getProfessional = (id: string) =>
  request<{ professional: ProfessionalProfile }>(
    `/api/professionals/${encodeURIComponent(id)}`,
  );
