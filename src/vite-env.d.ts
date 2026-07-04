/// <reference types="vite/client" />

declare module "jspdf" {
  export default class jsPDF {
    constructor();
    setFillColor(color: string): void;
    rect(x: number, y: number, w: number, h: number, style?: string): void;
    setTextColor(color: string): void;
    setFontSize(size: number): void;
    text(text: string, x: number, y: number): void;
    setDrawColor(color: string): void;
    line(x1: number, y1: number, x2: number, y2: number): void;
    save(filename: string): void;
  }
}
