export interface ProfessionalProfile {
  id: string;
  name: string;
  timezone: string;
}

export interface ProfessionalPage {
  professionals: ProfessionalProfile[];
  nextPage: number | null;
}
