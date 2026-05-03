import * as React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button, InfoBlock, Input } from '@tether/design';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { AdminAuthShell } from '../components/console/admin-auth-shell.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';
import { useAdminI18n } from '../hooks/use-i18n.js';
import { createAdmin } from '../lib/admin-api.js';

function createRegisterSchema(t: ReturnType<typeof useAdminI18n>['t']) {
  return z.object({
    email: z.string().min(1, t.emailRequired),
    password: z.string().min(8, t.passwordMinLength),
    confirmPassword: z.string().min(1, t.confirmPasswordRequired)
  }).refine((data) => data.password === data.confirmPassword, {
    message: t.passwordMismatch,
    path: ['confirmPassword']
  });
}

type RegisterFormValues = {
  email: string;
  password: string;
  confirmPassword: string;
};

export function AdminRegisterPage() {
  const navigate = useNavigate();
  const { managementAuth } = useAdminAuth();
  const { t } = useAdminI18n();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const registerSchema = React.useMemo(() => createRegisterSchema(t), [t]);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' }
  });

  async function onSubmit(values: RegisterFormValues) {
    setServerError(null);
    if (!managementAuth) {
      setServerError(t.mustSignInBeforeCreate);
      return;
    }
    try {
      await createAdmin(managementAuth.accessToken, { email: values.email, password: values.password });
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'email_already_registered') {
        setServerError(t.emailAlreadyRegistered);
      } else {
        setServerError(err instanceof Error ? err.message : t.registerFailed);
      }
    }
  }

  return (
    <AdminAuthShell
      mode="register"
      title={t.registerTitle}
      description={t.registerDescription}
      footer={
        <div className="space-y-3">
          <InfoBlock
            variant={managementAuth ? 'success' : 'warning'}
            title={managementAuth ? t.permissionReadyTitle : t.permissionRequiredTitle}
            description={
              managementAuth
                ? t.permissionReadyDescription
                : t.permissionRequiredDescription
            }
          />
          <p className="text-sm text-center text-muted-foreground">
            <Link to="/admin/login" className="underline underline-offset-4">{t.loginFirstToContinue}</Link>
          </p>
        </div>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.emailLabel}</FormLabel>
                <FormControl>
                  <Input className="h-12 text-base" type="text" placeholder={t.adminEmailPlaceholder} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.passwordLabel}</FormLabel>
                <FormControl>
                  <Input className="h-12 text-base" type="password" placeholder={t.passwordRegisterPlaceholder} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.confirmPasswordLabel}</FormLabel>
                <FormControl>
                  <Input className="h-12 text-base" type="password" placeholder={t.confirmPasswordPlaceholder} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {serverError ? (
            <InfoBlock variant="error" title={t.createFailed} description={serverError} />
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t.creatingAdmin : t.createAdmin}
          </Button>
        </form>
      </Form>
    </AdminAuthShell>
  );
}
