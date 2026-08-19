/**
 * PipelineTimer - Hierarchical phase timing for startup instrumentation.
 *
 * Supports nested start/stop calls to produce a tree of phase timings.
 * Thread through the startup pipeline to measure where time is spent.
 */

export interface PhaseTiming {
  name: string;
  duration: number; // ms, 0.01ms precision
  children?: PhaseTiming[];
}

export interface StartupTiming {
  total: number; // total startup time in ms
  phases: PhaseTiming[]; // hierarchical phase tree
  memory?: {
    heapUsed: number; // bytes
    heapTotal: number;
  };
}

interface ActivePhase {
  name: string;
  start: number; // performance.now()
  children: PhaseTiming[];
}

export class PipelineTimer {
  private stack: ActivePhase[] = [];
  private rootPhases: PhaseTiming[] = [];
  private timerStart: number;

  constructor() {
    this.timerStart = performance.now();
  }

  /** Start a named phase. Nests under the current active phase if any. */
  start(name: string): void {
    this.stack.push({
      name,
      start: performance.now(),
      children: [],
    });
  }

  /** Stop a named phase. Records duration and attaches to parent. */
  stop(name: string): void {
    // Find the phase on the stack (should be the top)
    if (this.stack.length === 0) return;

    const top = this.stack[this.stack.length - 1];
    if (!top || top.name !== name) {
      // Mismatched stop; search for it in the stack
      for (let i = this.stack.length - 1; i >= 0; i--) {
        if (this.stack[i]?.name === name) {
          // Pop everything above it (auto-close)
          while (this.stack.length > i) {
            this.closeTop();
          }
          return;
        }
      }
      // Not found at all; no-op
      return;
    }

    this.closeTop();
  }

  /** Build the final StartupTiming result with memory snapshot. */
  getResult(): StartupTiming {
    // Auto-close any unclosed phases
    while (this.stack.length > 0) {
      this.closeTop();
    }

    const total = Math.round((performance.now() - this.timerStart) * 100) / 100;

    let memory: StartupTiming["memory"];
    try {
      const mem = Deno.memoryUsage();
      memory = {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      };
    } catch {
      // Deno.memoryUsage() may not be available in all contexts
    }

    return {
      total,
      phases: this.rootPhases,
      ...(memory ? { memory } : {}),
    };
  }

  /** Pop the top phase from the stack and record it. */
  private closeTop(): void {
    const phase = this.stack.pop();
    if (!phase) return;

    const duration = Math.round((performance.now() - phase.start) * 100) / 100;
    const timing: PhaseTiming = {
      name: phase.name,
      duration,
      ...(phase.children.length > 0 ? { children: phase.children } : {}),
    };

    // Attach to parent or root
    if (this.stack.length > 0) {
      const parent = this.stack[this.stack.length - 1];
      if (parent) {
        parent.children.push(timing);
      }
    } else {
      this.rootPhases.push(timing);
    }
  }
}
