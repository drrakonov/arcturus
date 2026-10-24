// Adapted from Aceternity UI Tabs by Manu Arora:
// https://ui.aceternity.com/components/tabs
// Controlled selection, scoped layout IDs and keyboard navigation for the terminal.
// The original decorative stacked panels are intentionally omitted.
import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";

export function Tabs<T extends string>({
    tabs,
    value,
    onChange,
    label
}: {
    tabs: { title: string; value: T }[];
    value: T;
    onChange: (value: T) => void;
    label: string;
}) {
    const id = useId();
    const reduceMotion = useReducedMotion();
    return (
        <div className="aceternity-tabs" role="tablist" aria-label={label}>
            {tabs.map((tab, index) => (
                <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={value === tab.value}
                    tabIndex={value === tab.value ? 0 : -1}
                    onClick={() => onChange(tab.value)}
                    onKeyDown={event => {
                        const next =
                            event.key === "ArrowRight"
                                ? (index + 1) % tabs.length
                                : event.key === "ArrowLeft"
                                  ? (index + tabs.length - 1) % tabs.length
                                  : event.key === "Home"
                                    ? 0
                                    : event.key === "End"
                                      ? tabs.length - 1
                                      : -1;
                        if (next < 0) return;
                        event.preventDefault();
                        onChange(tabs[next].value);
                        (
                            event.currentTarget.parentElement?.children[next] as HTMLButtonElement
                        )?.focus();
                    }}
                >
                    {value === tab.value && (
                        <motion.div
                            layoutId={`${id}-selected`}
                            className="tab-indicator"
                            transition={
                                reduceMotion
                                    ? { duration: 0 }
                                    : { type: "spring", bounce: 0.15, duration: 0.35 }
                            }
                        />
                    )}
                    <span>{tab.title}</span>
                </button>
            ))}
        </div>
    );
}
