import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui互換のalert variant定義である。
 */
const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm", {
  variants: {
    variant: {
      default: "bg-background text-foreground",
      destructive: "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

/**
 * shadcn/ui互換Alertのpropsである。
 */
export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

/**
 * 画面上部やフォーム内に状態メッセージを表示するalertである。
 *
 * @param props alert要素へ渡すprops。
 * @returns styled alert要素。
 */
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div className={cn(alertVariants({ variant }), className)} ref={ref} role="alert" {...props} />
));
Alert.displayName = "Alert";

/**
 * alertの見出しである。
 */
const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 className={cn("mb-1 font-medium leading-none tracking-tight", className)} ref={ref} {...props} />
  )
);
AlertTitle.displayName = "AlertTitle";

/**
 * alertの説明本文である。
 */
const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("text-sm [&_p]:leading-relaxed", className)} ref={ref} {...props} />
  )
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
