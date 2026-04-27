import { createContext, useContext } from 'react';
import type { PiiDetectAgent } from '@/agent/externalAgent/piiDetectAgent';

const NULL_DETECTOR: PiiDetectAgent = {
  async detect(): Promise<readonly never[]> {
    return [];
  },
};

export const PiiDetectorContext = createContext<PiiDetectAgent | null>(null);

export function usePiiDetector(): PiiDetectAgent {
  const detector = useContext(PiiDetectorContext);
  return detector ?? NULL_DETECTOR;
}
