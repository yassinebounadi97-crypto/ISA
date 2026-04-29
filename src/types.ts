/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Student {
  idx: number;
  name: string;
  isElite: boolean;
  average?: number;
  level?: 'A' | 'B' | 'C' | 'D';
  scores?: { code: string, value: number }[];
}

export interface CompetencyStats {
  code: string;
  A: string[]; // HTML-like strings or objects, we'll use names for simplicity
  B: string[];
  C: string[];
  D: string[];
}

export interface TeacherInfo {
  subject: string;
  level: string;
  className: string;
  stage: string;
}

export interface ISA2Stats {
  isaValue: string;
  pA: number;
  pB: number;
  pC: number;
  pD: number;
  totalStudents: number;
}
