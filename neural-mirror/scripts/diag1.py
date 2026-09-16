import warnings, numpy as np
np.seterr(all="warn")
rng = np.random.default_rng(7)
x = rng.normal(size=(240, 18))
w = rng.normal(scale=0.4, size=(18, 64))
y = x @ w + rng.normal(scale=0.05, size=(240, 64))
xs = (x[:190] - x[:190].mean(0)) / x[:190].std(0)
print("X dtype:", x.dtype, "numpy:", np.__version__)
print("xs finite:", np.isfinite(xs).all(), "max|x|:", np.abs(xs).max())
gram = xs.T @ xs
print("gram finite:", np.isfinite(gram).all(), "gram max:", gram.max())
sys_ = gram + np.eye(18)
c = np.linalg.solve(sys_, xs.T @ y[:190])
print("coef finite:", np.isfinite(c).all())
