let fitDeltaPx = 0;

export const setFitDeltaPx = (v: number): void => {
  fitDeltaPx = Math.round(v);
};

export const getFitDeltaPx = (): number => fitDeltaPx;


let bandFitPending = false;

export const requestBandFit = (): void => {
  bandFitPending = true;
};

export const consumeBandFit = (): boolean => {
  const p = bandFitPending;
  bandFitPending = false;
  return p;
};
