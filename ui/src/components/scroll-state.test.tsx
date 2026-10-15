/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSolid } from "../test-helpers/mount-solid.ts";
import { flush } from "../test-helpers/solid-settle.ts";
import { SessionDataScrollController } from "./session-data-scroll-controller.ts";
import { useScrollState } from "./solid/scroll-state.ts";

let container: HTMLDivElement;
let mounted: ReturnType<typeof mountSolid> | undefined;
let resized: ResizeObserverCallback;
const observe = vi.fn();
const unobserve = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = vi.fn();
    },
  );
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Scroller(props: { class?: string }) {
  const scrollState = useScrollState();
  return <div class={props.class} ref={scrollState} />;
}

function geometry(element: HTMLElement, reads: string[], name: string) {
  Object.defineProperties(element, {
    scrollHeight: {
      configurable: true,
      get: () => {
        reads.push(name);
        return 200;
      },
    },
    clientHeight: { configurable: true, value: 100 },
  });
}

describe("scroll state observation", () => {
  it("batches every scroller read before publishing after a Solid update", () => {
    mounted = mountSolid(
      () => (
        <>
          <Scroller />
          <Scroller />
        </>
      ),
      { container },
    );
    const elements = [...container.children] as HTMLElement[];
    const order: string[] = [];
    elements.forEach((element, index) => {
      geometry(element, order, `read-${index}`);
      Object.defineProperty(element, "dataset", {
        value: new Proxy(element.dataset, {
          set(target, key, value) {
            order.push("write");
            return Reflect.set(target, key, value);
          },
        }),
      });
    });
    flush();
    expect(order).toEqual([]);
    vi.advanceTimersToNextFrame();
    expect(order).toEqual(["read-0", "read-1", ...Array<string>(6).fill("write")]);
    expect(
      elements.map((element) => ({
        scrollable: element.dataset.scrollable,
        atStart: element.dataset.atStart,
        atEnd: element.dataset.atEnd,
      })),
    ).toEqual([
      { scrollable: "true", atStart: "true", atEnd: "false" },
      { scrollable: "true", atStart: "true", atEnd: "false" },
    ]);
    order.length = 0;
    elements[0]!.dispatchEvent(new Event("scroll"));
    elements[0]!.dispatchEvent(new Event("scroll"));
    expect(order).toEqual([]);
    vi.advanceTimersToNextFrame();
    expect(order).toEqual(["read-0"]);
  });

  it("updates scroll boundaries after resize and stops observing unmounted scrollers", () => {
    mounted = mountSolid(() => <Scroller />, { container });
    const element = container.firstElementChild as HTMLElement;
    geometry(element, [], "read");
    flush();
    vi.advanceTimersToNextFrame();
    element.scrollTop = 100;
    resized(
      [
        {
          target: element,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
          contentRect: new DOMRectReadOnly(),
        },
      ],
      {} as ResizeObserver,
    );
    expect(element.dataset.atEnd).toBe("false");
    vi.advanceTimersToNextFrame();
    expect(element.dataset.atEnd).toBe("true");
    mounted.unmount();
    expect(unobserve).toHaveBeenCalledWith(element);
  });

  it("shares a frame with the sidebar and never reads from its update entry point", () => {
    mounted = mountSolid(() => <Scroller class="sidebar-shell__body" />, { container });
    const element = container.firstElementChild as HTMLElement;
    const reads: string[] = [];
    geometry(element, reads, "read");
    flush();
    const notify = vi.fn();
    const sidebar = new SessionDataScrollController(notify);
    try {
      sidebar.synchronize(container);
      sidebar.update(element);
      expect(reads).toEqual([]);
      vi.advanceTimersToNextFrame();
      expect(reads).toEqual(["read"]);
      expect(sidebar.state).toBe("top");
      element.scrollTop = 50;
      sidebar.update(element);
      vi.advanceTimersToNextFrame();
      expect(sidebar.state).toBe("middle");
      expect(notify).toHaveBeenCalledTimes(2);
    } finally {
      sidebar.dispose();
    }
  });
});
