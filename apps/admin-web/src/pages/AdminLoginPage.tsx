import * as React from 'react';
import { Button, InfoBlock, Input } from '@tether/design';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { AdminAuthShell } from '../components/console/AdminAuthShell.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const loginSchema = z.object({
  email: z.string().min(1, '请输入账户名'),
  password: z.string().min(1, '请输入密码')
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function AdminLoginPage() {
  const navigate = useNavigate();
  const { loginManagement, managementAuth, authReady } = useAdminAuth();
  const [serverError, setServerError] = React.useState<string | null>(null);

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
      setServerError(err instanceof Error ? err.message : '登录失败');
    }
  }

  return (
    <AdminAuthShell
      mode="login"
      title="管理员登录"
      description="进入独立管理域后，你可以统一处理用户、终端、Gateway 与审计事件。"
      footer={
        <InfoBlock
          variant="info"
          title="后台访问边界"
          description="管理域和普通用户会话隔离，避免把高风险操作直接暴露到普通 session 控制面。"
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
                <FormLabel>账户名</FormLabel>
                <FormControl>
                  <Input className="h-12 text-base" type="text" placeholder="admin@example.com" {...field} />
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
                <FormLabel>密码</FormLabel>
                <FormControl>
                  <Input className="h-12 text-base" type="password" placeholder="输入管理员密码" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {serverError ? (
            <InfoBlock variant="error" title="登录失败" description={serverError} />
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? '登录中…' : '进入管理控制台'}
          </Button>
        </form>
      </Form>
    </AdminAuthShell>
  );
}
