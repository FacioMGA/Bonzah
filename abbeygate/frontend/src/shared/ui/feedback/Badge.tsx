import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../../shared/lib/utils"

const badgeVariants = cva(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2",
    {
        variants: {
            variant: {
                default:
                    "border-transparent bg-slate-900 text-slate-50 hover:bg-slate-900/80",
                secondary:
                    "border-transparent bg-slate-100 text-slate-900 hover:bg-slate-100/80",
                destructive:
                    "border-transparent bg-rose-500 text-slate-50 hover:bg-rose-500/80",
                outline: "text-slate-950",
                success:
                    "border-transparent bg-emerald-500 text-white hover:bg-emerald-600",
                warning:
                    "border-transparent bg-amber-500 text-white hover:bg-amber-600",
                ghost: "border-transparent bg-transparent text-slate-900 hover:bg-slate-100",
            },
            size: {
                default: "px-2.5 py-0.5 text-xs",
                sm: "px-2 py-0.5 text-[10px]",
                lg: "px-3 py-1 text-sm",
            }
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, size, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
    )
}

export { Badge, badgeVariants }
