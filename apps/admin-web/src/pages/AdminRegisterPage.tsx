import * as React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button, InfoBlock, Input } from '@tether/design';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { AdminAuthShell } from '../components/console/AdminAuthShell.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';
import { createAdmin } from '../lib/admin-api.js';

const registerSchema = z.object({
  email: z.string().min(1, '请输入账户名'),
  password: z.string().min(8, '密码至少 8 位'),
  confirmPassword: z.string().min(1, '请再次输入密码')
}).refine((data) => data.password === data.confirmPassword, {
  message: '两次密码不一致',
  path: ['confirmPassword']
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function AdminRegisterPage() {
  const navigate = useNavigate();
  const { managementAuth } = useAdminAuth();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' }
  });

  async function onSubmit(values: RegisterFormValues) {
    setServerError(null);
    if (!managementAuth) {
      setServerError('请先登录后再创建管理员账户');
      return;
    }
    try {
      await createAdmin(managementAuth.accessToken, { email: values.email, password: values.password });
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'email_already_registered') {
        setServerError('该邮箱已注册');
      } else {
        setServerError(err instanceof Error ? err.message : '注册失败');
      }
    }
  }

  return (
    <AdminAuthShell
      mode="register"
      title="创建管理员账户"
      description="新增后台操作员前，先确认你当前处于已认证的管理域上下文。"
      footer={
        <div className="space-y-3">
          <InfoBlock
            variant={managementAuth ? 'success' : 'warning'}
            title={managementAuth ? '已获得管理权限' : '需要先登录'}
            description={
              managementAuth
                ? '当前会话已具备创建管理员账户的权限。'
                : '注册管理员不是公开入口，必须由现有管理会话发起。'
            }
          />
          <p className="text-sm text-center text-muted-foreground">
            <Link to="/admin/login" className="underline underline-offset-4">已有账户？先登录再继续</Link>
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
                  <Input className="h-12 text-base" type="password" placeholder="至少 8 位" {...field} />
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
                <FormLabel>确认密码</FormLabel>
                <FormControl>
                  <Input className="h-12 text-base" type="password" placeholder="再次输入密码" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {serverError ? (
            <InfoBlock variant="error" title="创建失败" description={serverError} />
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? '创建中…' : '创建管理员账户'}
          </Button>
        </form>
      </Form>
    </AdminAuthShell>
  );
}
