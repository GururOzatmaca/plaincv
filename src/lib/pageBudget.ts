let fitDeltaPx = 0;

export const setFitDeltaPx = (v: number): void => {
  fitDeltaPx = Math.round(v);
};

export const getFitDeltaPx = (): number => fitDeltaPx;
