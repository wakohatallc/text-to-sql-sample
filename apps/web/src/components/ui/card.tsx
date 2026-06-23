import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui互換のcard rootである。
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} ref={ref} {...props} />
));
Card.displayName = "Card";

/**
 * card上部のheader領域である。
 */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("flex flex-col space-y-1.5 p-6", className)} ref={ref} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

/**
 * cardのタイトルである。
 */
const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("font-semibold leading-none tracking-tight", className)} ref={ref} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

/**
 * cardの補足説明である。
 */
const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("text-sm text-muted-foreground", className)} ref={ref} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

/**
 * cardの本文領域である。
 */
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div className={cn("p-6 pt-0", className)} ref={ref} {...props} />
);
CardContent.displayName = "CardContent";

/**
 * card下部の操作領域である。
 */
const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("flex items-center p-6 pt-0", className)} ref={ref} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
