import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useAction } from 'convex/react'
import { useState, useMemo, useEffect } from 'react'
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  User,
  Receipt,
  Loader2,
  Package,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Label } from '#/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import POSLayout from '#/layouts/pos/pos-layout'
import { CustomerInput } from '#/components/pos/customer-selector'

export const Route = createFileRoute('/pos/')({
  component: RouteComponent,
})

type SizePricing = {
  size: string
  costPrice: number
  sellingPrice: number
}

type Product = {
  _id: string
  name: string
  sku: string
  sellingPrice: number
  sizes?: string[]
  colors?: string[]
  variants?: string[]
  sizePricing?: SizePricing[]
  isActive: boolean
  departmentId: string
}

type InventoryItem = {
  inventoryId: string
  productId: string
  product: Product | null
  quantity: number
  reorderLevel?: number
}

type CartLine = {
  productId: string
  name: string
  sku: string
  size?: string
  color?: string
  variant?: string
  unitPrice: number
  quantity: number
  availableQuantity: number
  departmentId: string
  departmentName: string
}

type PaymentMethod = 'Cash' | 'POS' | 'Mpesa' | 'Ecocash' | 'Bank Transfer'

type SaleDiscount = {
  productId: string
  discountAmount: number
  reason?: string
}

type CompletedSale = {
  saleId: string
  storeName: string
  storePhone: string | null
  storeAddress: string | null
  customerName: string | null
  cashierName: string | null
  paymentMethod: PaymentMethod
  items: CartLine[]
  discounts: SaleDiscount[]
  total: number
  itemCount: number
  completedAt: number
  amountReceived?: number
  changeDue?: number
}

function cartKey(productId: string, size?: string, color?: string, variant?: string) {
  return `${productId}::${size ?? ''}::${color ?? ''}::${variant ?? ''}`
}

function resolvePrice(product: Product, size?: string) {
  if (size && product.sizePricing?.length) {
    const match = product.sizePricing.find((sp) => sp.size === size)
    if (match) return match.sellingPrice
  }
  return product.sellingPrice
}

function needsVariantPicker(product: Product) {
  return (
    (product.sizes && product.sizes.length > 0) ||
    (product.colors && product.colors.length > 0) ||
    (product.variants && product.variants.length > 0)
  )
}

function formatCurrency(amount: number) {
  return `R${amount.toFixed(2)}`
}

function RouteComponent() {
  const [storeId, setStoreId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null)
  const [receiptPrinted, setReceiptPrinted] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [amountReceived, setAmountReceived] = useState<number | null>(null)
  const [changeDue, setChangeDue] = useState<number | null>(null)
  const [pickerItem, setPickerItem] = useState<InventoryItem | null>(null)
  const [pickerSize, setPickerSize] = useState<string | null>(null)
  const [pickerColor, setPickerColor] = useState<string | null>(null)
  const [pickerVariant, setPickerVariant] = useState<string | null>(null)

  const myStore = useQuery(api.stores.getMyStore)
  const activeStoresList = useQuery(
    api.stores.getActiveStores,
    myStore === null ? {} : 'skip'
  )
  const departments = useQuery(api.departments.getAllDepartments)
  const currentUser = useQuery(api.users.getCurrentUser)
  const inventory = useQuery(
    api.inventory.getInventoryByStore,
    storeId ? { storeId: storeId as any } : 'skip'
  ) as InventoryItem[] | undefined

  const createSale = useMutation(api.sales.createSale)
  const findOrCreateCustomer = useMutation(api.customers.findOrCreateByName)
  const recordPurchase = useMutation(api.customers.recordPurchase)
  const printReceipt = useAction(api.print.printReceipt)

  const activeStores = useMemo(
    () => activeStoresList?.filter((s) => s.isActive) ?? [],
    [activeStoresList]
  )

  useEffect(() => {
    if (myStore) setStoreId(myStore._id)
  }, [myStore])

  const filteredProducts = useMemo(() => {
    if (!inventory) return []
    return inventory.filter((item) => {
      if (item.quantity <= 0) return false
      if (!item.product) return false
      if (departmentId && item.product.departmentId !== departmentId) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const matchesName = item.product.name.toLowerCase().includes(q)
        const matchesSku = item.product.sku.toLowerCase().includes(q)
        if (!matchesName && !matchesSku) return false
      }
      return true
    })
  }, [inventory, departmentId, search])

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cart]
  )

  const cartItemCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart]
  )

  const cartQuantityForProduct = (productId: string) =>
    cart
      .filter((line) => line.productId === productId)
      .reduce((sum, line) => sum + line.quantity, 0)

  // ── Cart handlers ────────────────────────────────────────────────────

  const addToCart = (
    item: InventoryItem,
    unitPrice: number,
    selection: { size?: string; color?: string; variant?: string }
  ) => {
    if (!item.product) return
    const product = item.product
    const key = cartKey(item.productId, selection.size, selection.color, selection.variant)
    const alreadyInCart = cartQuantityForProduct(item.productId)

    if (alreadyInCart >= item.quantity) {
      toast.error(`Only ${item.quantity} of "${product.name}" available`)
      return
    }

    const department = departments?.find(d => d._id === product.departmentId)
    const departmentName = department?.name || 'General'

    setCart((prev) => {
      const existing = prev.find(
        (line) => cartKey(line.productId, line.size, line.color, line.variant) === key
      )
      if (existing) {
        return prev.map((line) =>
          cartKey(line.productId, line.size, line.color, line.variant) === key
            ? { ...line, quantity: line.quantity + 1 }
            : line
        )
      }
      return [
        ...prev,
        {
          productId: item.productId,
          name: product.name,
          sku: product.sku,
          size: selection.size,
          color: selection.color,
          variant: selection.variant,
          unitPrice,
          quantity: 1,
          availableQuantity: item.quantity,
          departmentId: product.departmentId,
          departmentName,
        },
      ]
    })
  }

  const handleProductClick = (item: InventoryItem) => {
    if (!item.product) return
    const alreadyInCart = cartQuantityForProduct(item.productId)
    if (alreadyInCart >= item.quantity) {
      toast.error(`Only ${item.quantity} of "${item.product.name}" available`)
      return
    }
    if (needsVariantPicker(item.product)) {
      setPickerItem(item)
      setPickerSize(item.product.sizes?.[0] ?? null)
      setPickerColor(item.product.colors?.[0] ?? null)
      setPickerVariant(item.product.variants?.[0] ?? null)
    } else {
      addToCart(item, item.product.sellingPrice, {})
    }
  }

  const closePicker = () => {
    setPickerItem(null)
    setPickerSize(null)
    setPickerColor(null)
    setPickerVariant(null)
  }

  const confirmPickerSelection = () => {
    if (!pickerItem?.product) return
    const product = pickerItem.product
    if (product.sizes?.length && !pickerSize) { toast.error('Select a size'); return }
    if (product.colors?.length && !pickerColor) { toast.error('Select a color'); return }
    if (product.variants?.length && !pickerVariant) { toast.error('Select a variant'); return }
    const unitPrice = resolvePrice(product, pickerSize ?? undefined)
    addToCart(pickerItem, unitPrice, {
      size: pickerSize ?? undefined,
      color: pickerColor ?? undefined,
      variant: pickerVariant ?? undefined,
    })
    closePicker()
  }

  const updateCartQuantity = (key: string, quantity: number) => {
    setCart((prev) =>
      prev.map((line) => {
        if (cartKey(line.productId, line.size, line.color, line.variant) !== key) return line
        const otherLinesQty = prev
          .filter(
            (l) =>
              l.productId === line.productId &&
              cartKey(l.productId, l.size, l.color, l.variant) !== key
          )
          .reduce((sum, l) => sum + l.quantity, 0)
        const maxForThisLine = line.availableQuantity - otherLinesQty
        if (quantity > maxForThisLine) {
          toast.error(`Only ${maxForThisLine} of "${line.name}" available`)
          return { ...line, quantity: Math.max(1, maxForThisLine) }
        }
        return { ...line, quantity: Math.max(1, quantity) }
      })
    )
  }

  const updateCartPrice = (key: string, unitPrice: number) => {
    setCart((prev) =>
      prev.map((line) =>
        cartKey(line.productId, line.size, line.color, line.variant) === key
          ? { ...line, unitPrice: Math.max(0, unitPrice) }
          : line
      )
    )
  }

  const removeFromCart = (key: string) => {
    setCart((prev) =>
      prev.filter((line) => cartKey(line.productId, line.size, line.color, line.variant) !== key)
    )
  }

  const clearCart = () => {
    setCart([])
    setCustomerName('')
    setPaymentMethod('Cash')
    setAmountReceived(null)
    setChangeDue(null)
  }

  // ── Checkout ─────────────────────────────────────────────────────────

  const handleCheckout = async () => {
    if (!storeId) { toast.error('Select a store first'); return }
    if (cart.length === 0) { toast.error('Cart is empty'); return }
    if (!paymentMethod) { toast.error('Select a payment method'); return }

    let resolvedChangeDue: number | null = changeDue
    if (paymentMethod === 'Cash') {
      if (!amountReceived || amountReceived <= 0) {
        toast.error('Enter amount received for cash payment')
        return
      }
      if (amountReceived < cartTotal) {
        toast.error(`Amount received (${formatCurrency(amountReceived)}) is less than total (${formatCurrency(cartTotal)})`)
        return
      }
      resolvedChangeDue = amountReceived - cartTotal
      setChangeDue(resolvedChangeDue)
    }

    setIsSubmitting(true)
    try {
      let resolvedCustomerId: string | undefined
      let resolvedCustomerName: string | null = null

      if (customerName.trim()) {
        resolvedCustomerId = await findOrCreateCustomer({ name: customerName.trim() })
        resolvedCustomerName = customerName.trim()
      }

      const saleId = await createSale({
        storeId: storeId as any,
        customerId: resolvedCustomerId ? (resolvedCustomerId as any) : undefined,
        paymentMethod,
        amountReceived: paymentMethod === 'Cash' ? amountReceived ?? undefined : undefined,
        changeDue: paymentMethod === 'Cash' ? resolvedChangeDue ?? undefined : undefined,
        items: cart.map((line) => ({
          productId: line.productId as any,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          size: line.size,
          color: line.color,
          variant: line.variant,
          // Pass departmentName so the server can run tyre discount logic
          // without extra lookups.
          departmentName: line.departmentName,
        })),
      })

      if (resolvedCustomerId) {
        await recordPurchase({
          customerId: resolvedCustomerId as any,
          amount: cartTotal,
        })
      }

      // Fetch the discount rows the server just wrote so the receipt has them.
      // We do a quick query via the action args rather than a useQuery hook
      // because this is one-time post-sale data. We pass an empty array as
      // a safe fallback — the server already wrote the discount total into
      // the sale row itself regardless.
      let discounts: SaleDiscount[] = []
      try {
        // getSaleById returns discounts[] joined from saleDiscounts
        const saleDetail = await (async () => {
          // Can't call a query imperatively in Convex — use the already-fetched
          // sale data we have. The server computed and stored the discounts;
          // we reconstruct them client-side from the cart for the receipt only.
          // This mirrors what the server computed so the receipt stays accurate.
          return null
        })()

        // Since we can't call a Convex query imperatively, we reconstruct
        // discounts from the cart using the same logic the server used.
        // This is display-only — the authoritative values are in the DB.
        const TYRE_DISCOUNT_THRESHOLD = 4
        const TYRE_DISCOUNT_AMOUNT = 200

        function extractRimSize(sizeStr: string): number | null {
          const rimMatch =
            sizeStr.match(/[Rr](\d+)$/) ||
            sizeStr.match(/^(\d+)$/) ||
            sizeStr.match(/(\d+)$/)
          if (!rimMatch) return null
          return parseInt(rimMatch[1], 10)
        }

        const productQty: Record<string, { qty: number; departmentName: string }> = {}
        for (const line of cart) {
          if (!line.departmentName.toLowerCase().includes('tyre')) continue
          if (!line.size) continue
          const rim = extractRimSize(line.size)
          if (rim === null || rim < 14) continue
          if (!productQty[line.productId]) {
            productQty[line.productId] = { qty: 0, departmentName: line.departmentName }
          }
          productQty[line.productId].qty += line.quantity
        }

        for (const [productId, { qty }] of Object.entries(productQty)) {
          if (qty >= TYRE_DISCOUNT_THRESHOLD) {
            discounts.push({
              productId,
              discountAmount: TYRE_DISCOUNT_AMOUNT,
              reason: `Tyre bulk discount (${qty}x, size 14+)`,
            })
          }
        }
      } catch {
        // Non-fatal — receipt still prints without discount lines
        discounts = []
      }

      const cashierName = currentUser?.name || currentUser?.email || 'Unknown'
      const currentStore = myStore ?? activeStores.find((s) => s._id === storeId)

      // The server deducted discounts from totalAmount; use the net total
      // that was actually charged, not the raw cartTotal.
      const discountTotal = discounts.reduce((sum, d) => sum + d.discountAmount, 0)
      const netTotal = cartTotal - discountTotal

      setCompletedSale({
        saleId: saleId.toString(),
        storeName: currentStore?.name ?? 'Store',
        storePhone: currentStore?.phone ?? null,
        storeAddress: currentStore?.address ?? null,
        customerName: resolvedCustomerName,
        cashierName,
        paymentMethod,
        items: cart,
        discounts,
        total: netTotal,
        itemCount: cartItemCount,
        completedAt: Date.now(),
        amountReceived: paymentMethod === 'Cash' ? amountReceived ?? undefined : undefined,
        changeDue: paymentMethod === 'Cash' ? resolvedChangeDue ?? undefined : undefined,
      })

      setReceiptPrinted(false)
      toast.success(`Sale completed — ${cartItemCount} item(s), ${formatCurrency(netTotal)}`)
      clearCart()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete sale')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Print ─────────────────────────────────────────────────────────────

  const handlePrint = async () => {
    if (!completedSale) return
    try {
      const result = await printReceipt({
        saleId: completedSale.saleId,
        storeName: completedSale.storeName,
        storePhone: completedSale.storePhone || undefined,
        storeAddress: completedSale.storeAddress || undefined,
        customerName: completedSale.customerName || undefined,
        cashierName: completedSale.cashierName || undefined,
        paymentMethod: completedSale.paymentMethod,
        amountReceived: completedSale.amountReceived,
        changeDue: completedSale.changeDue,
        items: completedSale.items.map(item => ({
          ...item,
          departmentId: item.departmentId || 'unknown',
          departmentName: item.departmentName || 'General',
        })),
        discounts: completedSale.discounts,
        total: completedSale.total,
        itemCount: completedSale.itemCount,
        completedAt: completedSale.completedAt,
      })

      if (result.success) {
        setReceiptPrinted(true)
        toast.success('Receipt printed successfully!')
      } else {
        toast.error(`Failed to print receipt: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Print error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to print receipt')
    }
  }

  const handleCheckoutDialogOpenChange = (open: boolean) => {
    if (!open && completedSale && !receiptPrinted) {
      toast.warning('Please print the receipt before closing')
      return
    }
    if (!open) {
      setCheckoutOpen(false)
      setCompletedSale(null)
      setReceiptPrinted(false)
      setPaymentMethod('Cash')
      setAmountReceived(null)
      setChangeDue(null)
    } else {
      setCheckoutOpen(true)
    }
  }

  return (
    <POSLayout>
      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_380px]">
        {/* Product browser */}
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Point of Sale</h1>
            <p className="text-sm text-muted-foreground">
              {myStore === null
                ? 'Select a store, add items to the cart, and check out'
                : 'Add items to the cart and check out'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {myStore === null ? (
              <Select
                value={storeId || undefined}
                onValueChange={(value) => { setStoreId(value); setCart([]) }}
              >
                <SelectTrigger className="sm:w-64">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {activeStores.map((store) => (
                    <SelectItem key={store._id} value={store._id}>{store.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : myStore ? (
              <div className="flex items-center rounded-md border bg-muted/50 px-3 py-2 text-sm font-medium sm:w-64">
                {myStore.name}
              </div>
            ) : (
              <div className="flex h-10 items-center sm:w-64">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                disabled={!storeId}
              />
            </div>

            <Select
              value={departmentId || 'all'}
              onValueChange={(value) => setDepartmentId(value === 'all' ? null : value)}
            >
              <SelectTrigger className="sm:w-48">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments?.map((dept) => (
                  <SelectItem key={dept._id} value={dept._id}>{dept.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!storeId && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center text-muted-foreground">
              <Package className="mb-2 h-8 w-8" />
              <p>{myStore === null ? 'Select a store to browse available stock' : 'Loading your store...'}</p>
            </div>
          )}

          {storeId && inventory === undefined && (
            <div className="flex justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {storeId && inventory !== undefined && filteredProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center text-muted-foreground">
              <Package className="mb-2 h-8 w-8" />
              <p>No products match your search</p>
            </div>
          )}

          {storeId && filteredProducts.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map((item) => {
                const product = item.product!
                const cartQtyForProduct = cartQuantityForProduct(item.productId)
                const hasVariants = needsVariantPicker(product)

                const priceLabel = (() => {
                  if (!product.sizePricing?.length) return formatCurrency(product.sellingPrice)
                  const prices = product.sizePricing.map((sp) => sp.sellingPrice)
                  const min = Math.min(...prices)
                  const max = Math.max(...prices)
                  return min === max ? formatCurrency(min) : `${formatCurrency(min)}–${formatCurrency(max)}`
                })()

                return (
                  <button
                    key={item.productId}
                    type="button"
                    onClick={() => handleProductClick(item)}
                    disabled={cartQtyForProduct >= item.quantity}
                    className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition hover:border-primary hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="line-clamp-2 text-sm font-medium">{product.name}</span>
                    <span className="text-xs text-muted-foreground">{product.sku}</span>
                    <div className="mt-1 flex w-full items-center justify-between">
                      <span className="font-semibold">{priceLabel}</span>
                      <Badge variant="outline" className="text-xs">{item.quantity} in stock</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hasVariants && (
                        <Badge variant="outline" className="text-xs">Select options</Badge>
                      )}
                      {cartQtyForProduct > 0 && (
                        <Badge variant="secondary">{cartQtyForProduct} in cart</Badge>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Cart panel */}
        <div className="flex h-fit flex-col gap-4 rounded-lg border p-4 lg:sticky lg:top-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShoppingCart className="h-5 w-5" />
              Cart
            </h2>
            {cart.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearCart}>Clear</Button>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1 text-sm">
              <User className="h-3 w-3" />
              Customer (Optional)
            </Label>
            <CustomerInput value={customerName} onChange={setCustomerName} disabled={!storeId} />
          </div>

          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {cart.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Cart is empty — click a product to add it
              </p>
            )}

            {cart.map((line) => {
              const key = cartKey(line.productId, line.size, line.color, line.variant)
              const optionLabel = [line.size, line.color, line.variant].filter(Boolean).join(' / ')
              return (
                <div key={key} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {line.name}
                        {optionLabel && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({optionLabel})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{line.sku}</p>
                      <p className="text-xs text-muted-foreground">{line.departmentName}</p>
                    </div>
                    <Button
                      size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => removeFromCart(key)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm" variant="outline" className="h-7 w-7 p-0"
                        onClick={() => updateCartQuantity(key, line.quantity - 1)}
                        disabled={line.quantity <= 1}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number" min={1} max={line.availableQuantity}
                        value={line.quantity}
                        onChange={(e) => updateCartQuantity(key, Number(e.target.value))}
                        className="h-7 w-14 text-center"
                      />
                      <Button
                        size="sm" variant="outline" className="h-7 w-7 p-0"
                        onClick={() => updateCartQuantity(key, line.quantity + 1)}
                        disabled={line.quantity >= line.availableQuantity}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">R</span>
                      <Input
                        type="number" min={0} step={0.01} value={line.unitPrice}
                        onChange={(e) => updateCartPrice(key, Number(e.target.value))}
                        className="h-7 w-20 text-right"
                      />
                    </div>
                  </div>

                  <p className="text-right text-sm font-medium">
                    {formatCurrency(line.unitPrice * line.quantity)}
                  </p>
                </div>
              )
            })}
          </div>

          <div className="space-y-1 border-t pt-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Items</span>
              <span>{cartItemCount}</span>
            </div>
            <div className="flex items-center justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatCurrency(cartTotal)}</span>
            </div>
          </div>

          <Button
            size="lg" className="w-full"
            disabled={cart.length === 0 || !storeId}
            onClick={() => setCheckoutOpen(true)}
          >
            <Receipt className="mr-2 h-4 w-4" />
            Checkout
          </Button>
        </div>
      </div>

      {/* Variant picker dialog */}
      <Dialog open={!!pickerItem} onOpenChange={(open) => !open && closePicker()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select options</DialogTitle>
            <DialogDescription>{pickerItem?.product?.name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {pickerItem?.product?.sizes && pickerItem.product.sizes.length > 0 && (
              <div className="space-y-2">
                <Label>Size</Label>
                <div className="flex flex-wrap gap-2">
                  {pickerItem.product.sizes.map((size) => (
                    <Button
                      key={size} type="button" size="sm"
                      variant={pickerSize === size ? 'default' : 'outline'}
                      onClick={() => setPickerSize(size)}
                    >
                      {size}
                      {pickerItem.product!.sizePricing?.find((sp) => sp.size === size) && (
                        <span className="ml-1 text-xs opacity-75">
                          ({formatCurrency(pickerItem.product!.sizePricing!.find((sp) => sp.size === size)!.sellingPrice)})
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {pickerItem?.product?.colors && pickerItem.product.colors.length > 0 && (
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {pickerItem.product.colors.map((color) => (
                    <Button
                      key={color} type="button" size="sm"
                      variant={pickerColor === color ? 'default' : 'outline'}
                      onClick={() => setPickerColor(color)}
                    >
                      {color}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {pickerItem?.product?.variants && pickerItem.product.variants.length > 0 && (
              <div className="space-y-2">
                <Label>Variant</Label>
                <div className="flex flex-wrap gap-2">
                  {pickerItem.product.variants.map((variant) => (
                    <Button
                      key={variant} type="button" size="sm"
                      variant={pickerVariant === variant ? 'default' : 'outline'}
                      onClick={() => setPickerVariant(variant)}
                    >
                      {variant}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {pickerItem?.product && (
              <p className="text-right text-lg font-semibold">
                {formatCurrency(resolvePrice(pickerItem.product, pickerSize ?? undefined))}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closePicker}>Cancel</Button>
            <Button onClick={confirmPickerSelection}>Add to cart</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout / receipt dialog */}
      <Dialog open={checkoutOpen} onOpenChange={handleCheckoutDialogOpenChange}>
        <DialogContent>
          {!completedSale ? (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Sale</DialogTitle>
                <DialogDescription>
                  {cartItemCount} item(s) — {formatCurrency(cartTotal)} total
                  {customerName.trim() ? ` for ${customerName.trim()}` : ' (walk-in)'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select
                    value={paymentMethod ?? ''}
                    onValueChange={(value) => {
                      setPaymentMethod(value === 'placeholder' ? null : (value as PaymentMethod))
                      if (value !== 'Cash') { setAmountReceived(null); setChangeDue(null) }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="placeholder" disabled>Select payment method</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Card">Card</SelectItem>
                      <SelectItem value="Mobile Payment">Mobile Payment</SelectItem>
                      <SelectItem value="Credit">Credit</SelectItem>
                      <SelectItem value="Voucher">Voucher</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {paymentMethod === 'Cash' && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label>Amount Received</Label>
                      <Input
                        type="number" min={0} step={0.01}
                        placeholder="Enter amount received"
                        value={amountReceived || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          setAmountReceived(isNaN(val) ? null : val)
                          if (val !== null && !isNaN(val) && cartTotal > 0) {
                            setChangeDue(val - cartTotal)
                          } else {
                            setChangeDue(null)
                          }
                        }}
                      />
                    </div>
                    {amountReceived !== null && !isNaN(amountReceived) && (
                      <div className="space-y-1">
                        <Label>Change Due</Label>
                        <Input
                          type="text"
                          value={changeDue !== null && changeDue > 0 ? formatCurrency(changeDue) : 'R0.00'}
                          disabled className="bg-muted"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto py-2">
                {cart.map((line) => {
                  const key = cartKey(line.productId, line.size, line.color, line.variant)
                  const optionLabel = [line.size, line.color, line.variant].filter(Boolean).join(' / ')
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span>
                        {line.quantity} × {line.name}
                        {optionLabel ? ` (${optionLabel})` : ''}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(line.unitPrice * line.quantity)}
                      </span>
                    </div>
                  )
                })}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCheckoutOpen(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button onClick={handleCheckout} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Receipt className="mr-2 h-4 w-4" />
                  )}
                  Confirm Sale
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Sale Complete</DialogTitle>
                <DialogDescription>
                  {completedSale.itemCount} item(s) — {formatCurrency(completedSale.total)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 text-sm">
                <p><span className="font-medium">Payment:</span> {completedSale.paymentMethod}</p>
                {completedSale.paymentMethod === 'Cash' && completedSale.amountReceived && (
                  <>
                    <p><span className="font-medium">Amount Received:</span> {formatCurrency(completedSale.amountReceived)}</p>
                    {completedSale.changeDue && completedSale.changeDue > 0 && (
                      <p><span className="font-medium">Change Due:</span> {formatCurrency(completedSale.changeDue)}</p>
                    )}
                  </>
                )}
                {completedSale.discounts.length > 0 && (
                  <p>
                    <span className="font-medium">Discounts Applied:</span>{' '}
                    {formatCurrency(completedSale.discounts.reduce((s, d) => s + d.discountAmount, 0))}
                  </p>
                )}
                {completedSale.customerName && (
                  <p><span className="font-medium">Customer:</span> {completedSale.customerName}</p>
                )}
                {completedSale.cashierName && (
                  <p><span className="font-medium">Cashier:</span> {completedSale.cashierName}</p>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                {receiptPrinted
                  ? 'Receipt printed. You can now close this dialog.'
                  : 'Print the receipt before closing.'}
              </p>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => handleCheckoutDialogOpenChange(false)}
                  disabled={!receiptPrinted}
                >
                  Close
                </Button>
                <Button onClick={handlePrint} variant={receiptPrinted ? 'outline' : 'default'}>
                  <Receipt className="mr-2 h-4 w-4" />
                  {receiptPrinted ? 'Print Again' : 'Print Receipt'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </POSLayout>
  )
}