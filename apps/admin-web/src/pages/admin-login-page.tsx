import * as React from 'react';
import { Button, InfoBlock, Input } from '@tether/design';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { AdminAuthShell } from '../components/console/admin-auth-shell.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';
import { useAdminI18n } from '../hooks/use-i18n.js';

function createLoginSchema(t: ReturnType<typeof useAdminI18n>['t']) {
  return z.object({
    email: z.string().min(1, t.emailRequired),
    password: z.string().min(1, t.passwordRequired)
  });
}

type LoginFormValues = {
  email: string;
  password: string;
};

export function AdminLoginPage() {
  const navigate = useNavigate();
  const { loginManagement, managementAuth, authReady } = useAdminAuth();
  const { t } = useAdminI18n();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const loginSchema = React.useMemo(() => createLoginSchema(t), [t]);

  React.useEffect(() => {
    if (authReady && managementAuth) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [authReady, managementAuth, navigate]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' }
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    try {
      await loginManagement(values);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t.signInFailed);
    }
  }

  return (
    <AdminAuthShell
      mode="login"
      title={t.loginTitle}
      description={t.loginDescription}
      footer={
        <InfoBlock
          variant="info"
          title={t.accessBoundaryTitle}
          description={t.accessBoundaryDescription}
        />
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
                  <Input className="h-12 text-base" type="password" placeholder={t.passwordLoginPlaceholder} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {serverError ? (
            <InfoBlock variant="error" title={t.signInFailed} description={serverError} />
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t.signingIn : t.signIn}
          </Button>
        </form>
      </Form>
    </AdminAuthShell>
  );
}
